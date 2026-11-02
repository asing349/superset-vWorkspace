import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { analyzeWithCodex } from "../codex/analyze";
import { TicketPlanService } from "./service";
import { TicketPlanStore } from "./store";
import { type TicketPlanSnapshot, ticketPlanScopeSchema } from "./types";

const scope = ticketPlanScopeSchema.parse({
	taskId: "task",
	unifiedId: "local:task",
	ticketKey: "ENG-1",
	repos: [{ projectId: "a" }, { projectId: "b" }],
	approvedContextProjectId: "a",
	executorAgent: "codex",
});
const snapshot: TicketPlanSnapshot = {
	hash: "context-and-repo-state",
	context: "Fix the issue",
	cwd: "/repo/a",
	repositories: [
		{ projectId: "a", path: "/repo/a", head: "aaa" },
		{ projectId: "b", path: "/repo/b", head: "bbb" },
	],
};
let directory: string;
let store: TicketPlanStore;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "superset-plan-test-"));
	store = new TicketPlanStore(directory);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function analyzer(decision = "approved"): typeof analyzeWithCodex {
	let calls = 0;
	return async () => ({
		sessionId: `session-${++calls}`,
		text:
			calls === 1
				? JSON.stringify({
						plan: "Edit the scoped file, test, open PR and stop. Never merge.",
					})
				: JSON.stringify({ decision, feedback: ["Concrete review feedback"] }),
	});
}
describe("independent plan gate", () => {
	test("planner and reviewer run separately, and one-use approval survives service restart", async () => {
		const prompts: string[] = [];
		const analyze = analyzer();
		const service = new TicketPlanService(store, async (input) => {
			prompts.push(input.prompt);
			return analyze(input);
		});
		const plan = await service.prepare(scope, snapshot);
		expect(plan.state).toBe("approved");
		expect(plan.plannerSessionId).not.toBe(plan.reviewerSessionId);
		expect(prompts[0]).toContain("PLANNER");
		expect(prompts[1]).toContain("INDEPENDENT REVIEWER");
		expect(prompts[1]).toContain("never merge");
		const restarted = new TicketPlanService(
			new TicketPlanStore(directory),
			analyzer(),
		);
		expect(restarted.consume(plan.id, scope, snapshot)).toBe(plan.plan);
		expect(() => restarted.consume(plan.id, scope, snapshot)).toThrow(
			"approve",
		);
	});
	test("revision requests and human escalation cannot dispatch", async () => {
		for (const decision of ["revise", "escalate"]) {
			const service = new TicketPlanService(store, analyzer(decision));
			const plan = await service.prepare(scope, snapshot);
			expect(plan.state).toBe(decision === "escalate" ? "escalated" : "revise");
			expect(plan.feedback).toEqual(["Concrete review feedback"]);
			expect(() => service.consume(plan.id, scope, snapshot)).toThrow();
		}
	});
	test("malformed or unavailable reviewer fails closed", async () => {
		for (const reply of [
			"not JSON",
			'{"decision":"approved"}',
			'{"decision":"maybe","feedback":["?"]}',
		]) {
			let calls = 0;
			const service = new TicketPlanService(store, async () => ({
				sessionId: `s-${++calls}`,
				text: calls === 1 ? '{"plan":"Scoped fix"}' : reply,
			}));
			const plan = await service.prepare(scope, snapshot);
			expect(plan.state).toBe("escalated");
			expect(() => service.consume(plan.id, scope, snapshot)).toThrow();
		}
		const service = new TicketPlanService(store, async () => {
			throw new Error("No connected account");
		});
		expect((await service.prepare(scope, snapshot)).state).toBe("escalated");
	});
	test("reusing the planner session cannot count as independent approval", async () => {
		let calls = 0;
		const service = new TicketPlanService(store, async () => ({
			sessionId: "same",
			text:
				++calls === 1
					? '{"plan":"Scoped fix"}'
					: '{"decision":"approved","feedback":["yes"]}',
		}));
		expect((await service.prepare(scope, snapshot)).state).toBe("escalated");
	});
	test("changing repo state, context or executor invalidates approval", async () => {
		const service = new TicketPlanService(store, analyzer());
		const plan = await service.prepare(scope, snapshot);
		expect(() =>
			service.consume(plan.id, scope, { ...snapshot, hash: "changed" }),
		).toThrow("stale");
		expect(() =>
			service.consume(plan.id, { ...scope, executorAgent: "claude" }, snapshot),
		).toThrow("different");
		await expect(
			service.review(plan.id, "revised", { ...snapshot, hash: "changed" }),
		).rejects.toThrow("changed");
	});
	test("revised plan must be independently reviewed again; attempts are bounded", async () => {
		const service = new TicketPlanService(store, analyzer("revise"));
		const plan = await service.prepare(scope, snapshot);
		const revised = await service.review(plan.id, "Revised plan", snapshot);
		expect(revised.plan).toBe("Revised plan");
		expect(revised.reviewAttempts).toBe(2);
		await service.review(plan.id, "Still revised", snapshot);
		const escalated = await service.review(plan.id, "Again", snapshot);
		expect(escalated.state).toBe("escalated");
		expect(escalated.feedback[0]).toContain("Three review attempts");
	});
	test("store refuses path traversal and records are persisted locally", async () => {
		expect(() => store.get("../../credentials")).toThrow();
		const plan = await new TicketPlanService(store, analyzer()).prepare(
			scope,
			snapshot,
		);
		expect(store.get(plan.id)).toEqual(plan);
	});
});
