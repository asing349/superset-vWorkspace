import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { memoryPlaybooks, projects } from "../../db/schema";
import {
	ANTI_PATTERN_PREFIX,
	reconcilePlaybooksForPr,
} from "./pr-capture-reconciler.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

const PROJECT_ID = "project-1";

function insertPlaybook(
	db: HostDb,
	{
		id,
		prNumber,
		status = "provisional",
		gotcha = null,
	}: {
		id: string;
		prNumber: number | null;
		status?: string;
		gotcha?: string | null;
	},
): void {
	db.insert(memoryPlaybooks)
		.values({
			id,
			projectId: PROJECT_ID,
			intent: `intent ${id}`,
			status,
			gotcha,
			provenanceJson: JSON.stringify({
				prNumber,
				url: null,
				taskId: null,
			}),
		})
		.run();
}

function statusOf(
	db: HostDb,
	id: string,
): { status: string; gotcha: string | null } {
	const row = db
		.select({ status: memoryPlaybooks.status, gotcha: memoryPlaybooks.gotcha })
		.from(memoryPlaybooks)
		.where(eq(memoryPlaybooks.id, id))
		.get();
	if (!row) throw new Error(`playbook ${id} not found`);
	return row;
}

describe("reconcilePlaybooksForPr (B2 confirm/demote)", () => {
	let db: HostDb;

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: PROJECT_ID, repoPath: "/tmp/repo" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("confirms the matching provisional playbook on merge", () => {
		insertPlaybook(db, { id: "pb-1", prNumber: 42 });

		const result = reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 42,
			terminalState: "merged",
		});

		expect(result.confirmed).toEqual(["pb-1"]);
		expect(result.demoted).toEqual([]);
		expect(statusOf(db, "pb-1").status).toBe("confirmed");
	});

	it("demotes and flags an anti-pattern on close-unmerged", () => {
		insertPlaybook(db, { id: "pb-2", prNumber: 7, gotcha: "watch the lock" });

		const result = reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 7,
			terminalState: "closed",
		});

		expect(result.demoted).toEqual(["pb-2"]);
		const row = statusOf(db, "pb-2");
		expect(row.status).toBe("demoted");
		expect(row.gotcha?.startsWith(ANTI_PATTERN_PREFIX)).toBe(true);
		expect(row.gotcha).toContain("watch the lock");
	});

	it("is a no-op when no playbook matches the PR number", () => {
		insertPlaybook(db, { id: "pb-3", prNumber: 99 });

		const result = reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 42,
			terminalState: "merged",
		});

		expect(result.confirmed).toEqual([]);
		expect(result.demoted).toEqual([]);
		expect(statusOf(db, "pb-3").status).toBe("provisional");
	});

	it("is idempotent — a second merge call does not re-touch a confirmed row", () => {
		insertPlaybook(db, { id: "pb-4", prNumber: 1 });

		const first = reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 1,
			terminalState: "merged",
		});
		expect(first.confirmed).toEqual(["pb-4"]);

		// Second call: the row is now `confirmed`, so it is no longer matched
		// (the reconciler only acts on `provisional` rows).
		const second = reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 1,
			terminalState: "merged",
		});
		expect(second.confirmed).toEqual([]);
		expect(statusOf(db, "pb-4").status).toBe("confirmed");
	});

	it("only reconciles playbooks in the given project", () => {
		const other = "project-2";
		db.insert(projects).values({ id: other, repoPath: "/tmp/other" }).run();
		db.insert(memoryPlaybooks)
			.values({
				id: "pb-other",
				projectId: other,
				intent: "other",
				status: "provisional",
				provenanceJson: JSON.stringify({
					prNumber: 42,
					url: null,
					taskId: null,
				}),
			})
			.run();
		insertPlaybook(db, { id: "pb-mine", prNumber: 42 });

		reconcilePlaybooksForPr({
			db,
			projectId: PROJECT_ID,
			prNumber: 42,
			terminalState: "merged",
		});

		expect(statusOf(db, "pb-mine").status).toBe("confirmed");
		// The other project's same-numbered PR playbook is untouched.
		expect(statusOf(db, "pb-other").status).toBe("provisional");
	});
});
