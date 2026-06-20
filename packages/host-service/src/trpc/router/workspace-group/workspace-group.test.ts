import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import {
	createSqliteWorkspaceGroupStore,
	getGroupAgentRootPath,
	prepareAgentRoot,
	WorkspaceGroupResolver,
} from "../../../runtime/workspace-groups";
import type { HostServiceContext } from "../../../types";
import { workspaceGroupRouter } from "./workspace-group";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("workspaceGroupRouter.delete (synthetic-dir cleanup, Q5)", () => {
	let db: HostDb;
	let homeDir: string;
	let targetsDir: string;
	let prevHomeEnv: string | undefined;

	beforeEach(() => {
		db = buildDb();
		homeDir = mkdtempSync(join(tmpdir(), "wg-delete-home-"));
		targetsDir = mkdtempSync(join(tmpdir(), "wg-delete-targets-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) {
			delete process.env.SUPERSET_HOME_DIR;
		} else {
			process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		}
		rmSync(homeDir, { recursive: true, force: true });
		rmSync(targetsDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function makeContext(): HostServiceContext {
		return {
			isAuthenticated: true,
			workspaceGroupStore: createSqliteWorkspaceGroupStore(db),
			workspaceGroupResolver: new WorkspaceGroupResolver({ db }),
		} as unknown as HostServiceContext;
	}

	it("removes the group-roots/<id> synthetic dir but NEVER the underlying folder/worktree", async () => {
		const ctx = makeContext();
		const caller = workspaceGroupRouter.createCaller(ctx);

		// Two real on-disk folder roots, each with a sentinel file we will assert
		// survives the delete (proving the symlink-only dir removal never touches
		// the real folders/worktrees).
		const folderA = join(targetsDir, "repo-a");
		const folderB = join(targetsDir, "repo-b");
		mkdirSync(folderA, { recursive: true });
		mkdirSync(folderB, { recursive: true });
		const sentinelA = join(folderA, "keep.txt");
		const sentinelB = join(folderB, "keep.txt");
		writeFileSync(sentinelA, "A");
		writeFileSync(sentinelB, "B");

		const group = await caller.create({
			name: "to-delete",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: folderA,
					label: "Repo A",
				},
				{
					kind: "folder",
					workspaceId: null,
					folderPath: folderB,
					label: "Repo B",
				},
			],
		});

		// Materialize the synthetic agent-root dir (one symlink per root) exactly as
		// launching the combined agent would.
		const agentRootPath = getGroupAgentRootPath(group.id);
		prepareAgentRoot({ groupId: group.id, roots: group.roots });
		expect(existsSync(agentRootPath)).toBe(true);
		expect(getGroupAgentRootPath(group.id)).toBe(agentRootPath);

		// Delete the group through the router.
		const result = await caller.delete({ id: group.id });
		expect(result).toEqual({ id: group.id });

		// The synthetic dir is gone…
		expect(existsSync(agentRootPath)).toBe(false);
		// …the group is gone from the store…
		expect(ctx.workspaceGroupStore.get(group.id)).toBeNull();
		// …and BOTH real folders + their sentinel files survive untouched (Q5: the
		// dir held only symlinks, so removing it can't delete the targets).
		expect(existsSync(folderA)).toBe(true);
		expect(existsSync(folderB)).toBe(true);
		expect(readFileSync(sentinelA, "utf8")).toBe("A");
		expect(readFileSync(sentinelB, "utf8")).toBe("B");
	});

	it("delete is best-effort when the synthetic dir was never prepared", async () => {
		const ctx = makeContext();
		const caller = workspaceGroupRouter.createCaller(ctx);
		const group = await caller.create({ name: "never-prepared", roots: [] });

		// No prepareAgentRoot call → no synthetic dir on disk.
		expect(existsSync(getGroupAgentRootPath(group.id))).toBe(false);

		// Delete must not throw despite the absent dir (force: true).
		await expect(caller.delete({ id: group.id })).resolves.toEqual({
			id: group.id,
		});
		expect(ctx.workspaceGroupStore.get(group.id)).toBeNull();
	});
});
