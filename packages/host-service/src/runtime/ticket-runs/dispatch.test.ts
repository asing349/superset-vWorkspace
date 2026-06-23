import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import {
	approvedTicketContext,
	memoryPracticeVersions,
	projects,
	ticketRuns,
} from "../../db/schema";
import { MemoryRetrieveService } from "../memory/retrieve-service.ts";
import {
	type CreateWorkspaceFn,
	dispatchTicketRun,
	TicketContextNotApprovedError,
} from "./dispatch.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	// Applies ALL migrations incl. 0010_ticket_runs — proves it lands on a fresh db.
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("dispatchTicketRun (B5 orchestrator lifecycle)", () => {
	let db: HostDb;
	let retrieve: MemoryRetrieveService;
	const taskId = "11111111-1111-4111-8111-111111111111";
	const projectA = "projA";
	const projectB = "projB";

	beforeEach(() => {
		db = buildDb();
		retrieve = new MemoryRetrieveService({ db });
		db.insert(projects).values({ id: projectA, repoPath: "/tmp/a" }).run();
		db.insert(projects).values({ id: projectB, repoPath: "/tmp/b" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function seedApprovedContext(projectId: string, content: string) {
		db.insert(approvedTicketContext)
			.values({ id: crypto.randomUUID(), projectId, taskId, content })
			.run();
	}

	function seedPractice(options: {
		scope: "project" | "global";
		projectId: string | null;
		content: string;
	}) {
		db.insert(memoryPracticeVersions)
			.values({
				id: crypto.randomUUID(),
				scope: options.scope,
				projectId: options.projectId,
				version: 1,
				content: options.content,
			})
			.run();
	}

	function runRow(runId: string) {
		return db.query.ticketRuns
			.findFirst({ where: eq(ticketRuns.id, runId) })
			.sync();
	}

	const okCreate: CreateWorkspaceFn = async (args) => ({
		workspaceId: `ws-${args.projectId}`,
		branch: `feat/${args.projectId}`,
	});

	it("throws when no approved context exists (must approve first)", async () => {
		await expect(
			dispatchTicketRun({
				db,
				retrieve,
				input: {
					taskId,
					ticketKey: "SUPER-1",
					repos: [{ projectId: projectA }],
					approvedContextProjectId: projectA,
				},
				createWorkspace: okCreate,
			}),
		).rejects.toBeInstanceOf(TicketContextNotApprovedError);
		// No run row is created when the precondition fails.
		expect(db.select().from(ticketRuns).all().length).toBe(0);
	});

	it("dispatching → dispatched on success, recording workspaceId + branch", async () => {
		seedApprovedContext(projectA, "approved work");
		const result = await dispatchTicketRun({
			db,
			retrieve,
			input: {
				taskId,
				ticketKey: "SUPER-2",
				repos: [{ projectId: projectA, baseBranch: "main" }],
				approvedContextProjectId: projectA,
			},
			createWorkspace: okCreate,
		});

		expect(result.runs).toHaveLength(1);
		const run = result.runs[0];
		expect(run?.status).toBe("dispatched");
		expect(run?.workspaceId).toBe("ws-projA");
		expect(run?.branch).toBe("feat/projA");

		const row = runRow(run?.runId ?? "");
		expect(row?.status).toBe("dispatched");
		expect(row?.workspaceId).toBe("ws-projA");
		expect(row?.branch).toBe("feat/projA");
		expect(row?.error ?? null).toBeNull();
		expect(row?.taskId).toBe(taskId);
	});

	it("dispatching → failed with error on a thrown createWorkspace", async () => {
		seedApprovedContext(projectA, "approved work");
		const result = await dispatchTicketRun({
			db,
			retrieve,
			input: {
				taskId,
				ticketKey: "SUPER-3",
				repos: [{ projectId: projectA }],
				approvedContextProjectId: projectA,
			},
			createWorkspace: async () => {
				throw new Error("worktree add failed");
			},
		});

		const run = result.runs[0];
		expect(run?.status).toBe("failed");
		expect(run?.error).toContain("worktree add failed");
		const row = runRow(run?.runId ?? "");
		expect(row?.status).toBe("failed");
		expect(row?.error).toContain("worktree add failed");
		expect(row?.workspaceId ?? null).toBeNull();
	});

	it("multi-repo records N rows and a partial failure does NOT abort the others", async () => {
		seedApprovedContext(projectA, "approved work");
		const result = await dispatchTicketRun({
			db,
			retrieve,
			input: {
				taskId,
				ticketKey: "SUPER-4",
				repos: [{ projectId: projectA }, { projectId: projectB }],
				approvedContextProjectId: projectA,
			},
			// Repo B fails AFTER repo A succeeds — partial failure.
			createWorkspace: async (args) => {
				if (args.projectId === projectB) throw new Error("repo B blew up");
				return { workspaceId: `ws-${args.projectId}`, branch: "feat/a" };
			},
		});

		expect(result.runs).toHaveLength(2);
		const a = result.runs.find((r) => r.projectId === projectA);
		const b = result.runs.find((r) => r.projectId === projectB);
		expect(a?.status).toBe("dispatched");
		expect(b?.status).toBe("failed");
		expect(b?.error).toContain("repo B blew up");

		// Two rows persisted, all sharing the same taskId.
		const rows = db
			.select()
			.from(ticketRuns)
			.where(eq(ticketRuns.taskId, taskId))
			.all();
		expect(rows).toHaveLength(2);
	});

	it("passes a layered prompt (global<project<approved) into createWorkspace", async () => {
		seedApprovedContext(projectA, "APPROVED_MARKER");
		seedPractice({
			scope: "global",
			projectId: null,
			content: "GLOBAL_MARKER",
		});
		seedPractice({
			scope: "project",
			projectId: projectA,
			content: "PROJECT_MARKER",
		});

		let capturedPrompt = "";
		await dispatchTicketRun({
			db,
			retrieve,
			input: {
				taskId,
				ticketKey: "SUPER-5",
				repos: [{ projectId: projectA }],
				approvedContextProjectId: projectA,
			},
			createWorkspace: async (args) => {
				capturedPrompt = args.prompt;
				return { workspaceId: "ws", branch: "b" };
			},
		});

		const iGlobal = capturedPrompt.indexOf("GLOBAL_MARKER");
		const iProject = capturedPrompt.indexOf("PROJECT_MARKER");
		const iApproved = capturedPrompt.indexOf("APPROVED_MARKER");
		expect(iGlobal).toBeGreaterThanOrEqual(0);
		expect(iGlobal).toBeLessThan(iProject);
		expect(iProject).toBeLessThan(iApproved);
		// Stop instruction present; never-merge enforced.
		expect(capturedPrompt).toContain("Do NOT merge");
		expect(capturedPrompt).not.toContain("gh pr merge --");
	});
});
