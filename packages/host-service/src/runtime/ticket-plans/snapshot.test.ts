import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import {
	approvedTicketContext,
	memoryPracticeVersions,
	projects,
} from "../../db/schema";
import { readTicketPlanSnapshot } from "./snapshot";
import { ticketPlanScopeSchema } from "./types";

let directory: string;
let sqlite: Database;
let db: HostDb;
const scope = ticketPlanScopeSchema.parse({
	taskId: "task",
	ticketKey: "T-1",
	repos: [{ projectId: "repo" }],
	approvedContextProjectId: "repo",
	executorAgent: "codex",
});
let head = "aaa";
let diff = "";
let refs = "aaa refs/heads/main";
const readGit = async (_path: string, args: string[]) => {
	if (args[0] === "rev-parse") return head;
	if (args[0] === "show-ref") return refs;
	if (args[0] === "diff") {
		expect(args).toContain("--no-ext-diff");
		expect(args).toContain("--no-textconv");
		return diff;
	}
	if (args[0] === "status") return "?? source.ts";
	if (args[0] === "ls-files") return "source.ts\0";
	throw new Error("Unexpected git query");
};
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "superset-plan-snapshot-"));
	writeFileSync(join(directory, "source.ts"), "original");
	sqlite = new Database(":memory:");
	const bunDb = drizzle(sqlite, { schema });
	db = bunDb as unknown as HostDb;
	migrate(bunDb, {
		migrationsFolder: resolve(import.meta.dir, "../../../drizzle"),
	});
	db.insert(projects).values({ id: "repo", repoPath: directory }).run();
	db.insert(approvedTicketContext)
		.values({
			id: "context",
			projectId: "repo",
			taskId: "task",
			content: "Approved task",
		})
		.run();
	head = "aaa";
	diff = "";
	refs = "aaa refs/heads/main";
});
afterEach(() => {
	sqlite.close();
	rmSync(directory, { recursive: true, force: true });
});
test("snapshot binds context, tracked diff, refs and untracked file bytes without running Git", async () => {
	const original = await readTicketPlanSnapshot(db, scope, readGit);
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).toBe(
		original.hash,
	);
	diff = "changed tracked file";
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).not.toBe(
		original.hash,
	);
	diff = "";
	writeFileSync(join(directory, "source.ts"), "modified");
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).not.toBe(
		original.hash,
	);
	writeFileSync(join(directory, "source.ts"), "original");
	refs = "bbb refs/heads/main";
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).not.toBe(
		original.hash,
	);
	refs = "aaa refs/heads/main";
	db.update(approvedTicketContext)
		.set({ content: "Changed task" })
		.where(eq(approvedTicketContext.id, "context"))
		.run();
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).not.toBe(
		original.hash,
	);
	db.update(approvedTicketContext)
		.set({ content: "Approved task" })
		.where(eq(approvedTicketContext.id, "context"))
		.run();
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).toBe(
		original.hash,
	);
	db.insert(memoryPracticeVersions)
		.values({
			id: crypto.randomUUID(),
			scope: "global",
			projectId: null,
			version: 1,
			content: "New coding convention",
		})
		.run();
	expect((await readTicketPlanSnapshot(db, scope, readGit)).hash).not.toBe(
		original.hash,
	);
});
test("missing context, duplicate repo or mismatched primary cannot prepare a plan", async () => {
	await expect(
		readTicketPlanSnapshot(db, { ...scope, taskId: "missing" }, readGit),
	).rejects.toThrow("Approve");
	await expect(
		readTicketPlanSnapshot(
			db,
			{ ...scope, repos: [...scope.repos, ...scope.repos] },
			readGit,
		),
	).rejects.toThrow("unique");
	await expect(
		readTicketPlanSnapshot(
			db,
			{ ...scope, repos: [{ projectId: "other" }] },
			readGit,
		),
	).rejects.toThrow("first");
});
