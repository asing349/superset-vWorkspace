import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects, ticketRuns } from "../../db/schema";
import {
	reconcileTicketRunForPr,
	resolveInReviewStatusId,
	type TaskStatusOption,
	type TicketTaskWriteback,
} from "./pr-loop-reconciler.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** A writeback fake that records calls and never hits the network. */
function fakeWriteback(
	options: {
		statuses?: TaskStatusOption[];
		failUpdate?: boolean;
		failList?: boolean;
	} = {},
) {
	const calls: {
		updates: Array<{ id: string; prUrl: string; statusId?: string }>;
		listCount: number;
	} = { updates: [], listCount: 0 };
	const writeback: TicketTaskWriteback = {
		async listStatuses() {
			calls.listCount += 1;
			if (options.failList) throw new Error("list failed");
			return options.statuses ?? [];
		},
		async updateTask(input) {
			if (options.failUpdate) throw new Error("update failed");
			calls.updates.push(input);
		},
	};
	return { writeback, calls };
}

describe("resolveInReviewStatusId (B6)", () => {
	it("prefers a status whose name contains 'review'", () => {
		const statuses: TaskStatusOption[] = [
			{ id: "s1", name: "In Progress", type: "started" },
			{ id: "s2", name: "In Review", type: "started" },
		];
		expect(resolveInReviewStatusId(statuses)).toBe("s2");
	});

	it("falls back to the first 'started' status when no review name", () => {
		const statuses: TaskStatusOption[] = [
			{ id: "s1", name: "Backlog", type: "backlog" },
			{ id: "s2", name: "Doing", type: "started" },
		];
		expect(resolveInReviewStatusId(statuses)).toBe("s2");
	});

	it("returns null when nothing sensible matches", () => {
		const statuses: TaskStatusOption[] = [
			{ id: "s1", name: "Backlog", type: "backlog" },
			{ id: "s2", name: "Done", type: "completed" },
		];
		expect(resolveInReviewStatusId(statuses)).toBeNull();
	});
});

describe("reconcileTicketRunForPr (B6 loop closure)", () => {
	let db: HostDb;
	const projectA = "projA";
	const projectB = "projB";
	const taskId = "task-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectA, repoPath: "/tmp/a" }).run();
		db.insert(projects).values({ id: projectB, repoPath: "/tmp/b" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function seedRun(options: {
		id: string;
		projectId: string;
		branch: string;
		prUrl?: string;
	}) {
		db.insert(ticketRuns)
			.values({
				id: options.id,
				taskId,
				projectId: options.projectId,
				status: "dispatched",
				branch: options.branch,
				prUrl: options.prUrl ?? null,
			})
			.run();
	}

	function runRow(id: string) {
		return db.query.ticketRuns
			.findFirst({ where: eq(ticketRuns.id, id) })
			.sync();
	}

	it("matches branch → run row, stamps pr_url, and writes back to the task", async () => {
		seedRun({ id: "run-1", projectId: projectA, branch: "feat/x" });
		const { writeback, calls } = fakeWriteback({
			statuses: [{ id: "rev", name: "In Review", type: "started" }],
		});

		const result = await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "feat/x",
			prUrl: "https://github.com/o/r/pull/7",
		});

		expect(result.linked).toEqual(["run-1"]);
		expect(result.taskWriteback).toBe("ok");
		expect(runRow("run-1")?.prUrl).toBe("https://github.com/o/r/pull/7");
		// Wrote the prUrl + resolved in-review status back to the cloud task.
		expect(calls.updates).toHaveLength(1);
		expect(calls.updates[0]).toEqual({
			id: taskId,
			prUrl: "https://github.com/o/r/pull/7",
			statusId: "rev",
		});
	});

	it("is a no-op when no run row matches the branch", async () => {
		seedRun({ id: "run-1", projectId: projectA, branch: "feat/x" });
		const { writeback, calls } = fakeWriteback();

		const result = await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "some-other-branch",
			prUrl: "https://github.com/o/r/pull/9",
		});

		expect(result.linked).toEqual([]);
		expect(result.taskWriteback).toBe("skipped");
		expect(calls.updates).toHaveLength(0);
		expect(runRow("run-1")?.prUrl ?? null).toBeNull();
	});

	it("links each repo's PR to the ONE shared ticket (multi-repo)", async () => {
		// Two run rows for the one ticket — different repos + branches.
		seedRun({ id: "run-a", projectId: projectA, branch: "feat/a" });
		seedRun({ id: "run-b", projectId: projectB, branch: "feat/b" });
		const { writeback, calls } = fakeWriteback({
			statuses: [{ id: "rev", name: "Review", type: "started" }],
		});

		const prA = "https://github.com/o/a/pull/1";
		const prB = "https://github.com/o/b/pull/2";
		await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "feat/a",
			prUrl: prA,
		});
		await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectB,
			headBranch: "feat/b",
			prUrl: prB,
		});

		expect(runRow("run-a")?.prUrl).toBe(prA);
		expect(runRow("run-b")?.prUrl).toBe(prB);
		// Both writebacks targeted the SAME taskId (one ticket, two PRs).
		expect(calls.updates.map((u) => u.id)).toEqual([taskId, taskId]);
		expect(calls.updates.map((u) => u.prUrl)).toEqual([prA, prB]);
	});

	it("swallows a writeback failure (does NOT throw) and still stamps pr_url", async () => {
		seedRun({ id: "run-1", projectId: projectA, branch: "feat/x" });
		const { writeback } = fakeWriteback({ failUpdate: true });

		const result = await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "feat/x",
			prUrl: "https://github.com/o/r/pull/7",
		});

		// pr_url is still stamped locally; the writeback is marked failed, not thrown.
		expect(result.linked).toEqual(["run-1"]);
		expect(result.taskWriteback).toBe("failed");
		expect(runRow("run-1")?.prUrl).toBe("https://github.com/o/r/pull/7");
	});

	it("still writes the prUrl when status resolution fails", async () => {
		seedRun({ id: "run-1", projectId: projectA, branch: "feat/x" });
		const { writeback, calls } = fakeWriteback({ failList: true });

		const result = await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "feat/x",
			prUrl: "https://github.com/o/r/pull/7",
		});

		expect(result.taskWriteback).toBe("ok");
		expect(calls.updates).toHaveLength(1);
		// No statusId (resolution failed) but the prUrl writeback still happened.
		expect(calls.updates[0]?.statusId).toBeUndefined();
		expect(calls.updates[0]?.prUrl).toBe("https://github.com/o/r/pull/7");
	});

	it("is idempotent — re-running with the same prUrl does not re-stamp", async () => {
		seedRun({
			id: "run-1",
			projectId: projectA,
			branch: "feat/x",
			prUrl: "https://github.com/o/r/pull/7",
		});
		const { writeback } = fakeWriteback();

		const result = await reconcileTicketRunForPr({
			db,
			writeback,
			projectId: projectA,
			headBranch: "feat/x",
			prUrl: "https://github.com/o/r/pull/7",
		});

		// Row already had this prUrl → not re-stamped.
		expect(result.linked).toEqual([]);
	});
});
