import { describe, expect, test } from "bun:test";
import type { TicketRunStartResult } from "../../../../hooks/useTicketRunStart";
import { ticketRunFeedback } from "./ticketRunFeedback";

type Run = TicketRunStartResult["runs"][number];
const projects = [
	{ id: "a", name: "Web" },
	{ id: "b", name: "API" },
];
function run(
	projectId: string,
	status: Run["status"],
	error: string | null = null,
): Run {
	return {
		projectId,
		status,
		error,
		runId: `run-${projectId}`,
		workspaceId: status === "dispatched" ? `ws-${projectId}` : null,
		branch: status === "dispatched" ? "feat/ticket" : null,
	};
}
function feedback(runs: Run[]) {
	return ticketRunFeedback({ result: { runs }, projects });
}

describe("ticket dispatch feedback", () => {
	test("single and multiple dispatched repos report dispatch success only", () => {
		for (const runs of [
			[run("a", "dispatched")],
			[run("a", "dispatched"), run("b", "dispatched")],
		]) {
			const result = feedback(runs);
			expect(result.severity).toBe("success");
			expect(result.message).toBe(
				`Run dispatched for ${runs.length} of ${runs.length} repos.`,
			);
			expect(result.message).not.toContain("PR");
		}
	});
	test("a resolved response with every repo failed is an error", () => {
		const result = feedback([
			run("a", "failed", "Missing approval"),
			run("b", "failed", "Permission denied"),
		]);
		expect(result.severity).toBe("error");
		expect(result.message).toBe("Dispatch failed for all 2 repos.");
		expect(result.runs.map((item) => item.error)).toEqual([
			"Missing approval",
			"Permission denied",
		]);
	});
	test("mixed results warn and preserve repo identities, errors and successful run details", () => {
		const runs = [
			run("a", "dispatched"),
			run("b", "failed", "Cannot create worktree\nAccess denied"),
		];
		const result = feedback(runs);
		expect(result.severity).toBe("warning");
		expect(result.message).toBe("Dispatched: 1; failed: 1; pending: 0.");
		expect(result.runs).toEqual([
			{ ...runs[0], projectName: "Web" },
			{ ...runs[1], projectName: "API" },
		]);
		expect(runs[0]).not.toHaveProperty("projectName");
	});
	test("a single failed repo without error details remains a failure", () => {
		const result = feedback([run("a", "failed")]);
		expect(result.severity).toBe("error");
		expect(result.runs[0]?.error).toBeNull();
	});
	test("dispatching is pending, never success or failure", () => {
		for (const runs of [
			[run("a", "dispatching")],
			[run("a", "dispatched"), run("b", "dispatching")],
			[run("a", "failed"), run("b", "dispatching")],
		]) {
			const result = feedback(runs);
			expect(result.severity).toBe("warning");
			expect(result.message).toContain("pending: 1");
		}
	});
	test("an empty response cannot imply successful launch", () => {
		const result = feedback([]);
		expect(result.severity).toBe("error");
		expect(result.message).toContain("Check workspaces before retrying");
	});
	test("unknown project names fall back to the stable project id", () => {
		expect(
			feedback([run("unknown", "failed", "No repo")]).runs[0]?.projectName,
		).toBe("unknown");
	});
});
