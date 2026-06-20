// Wave-2 M9: focused test of the terminal `rootTarget` / `agentRoot` resolution
// path (`resolveRootTarget` in terminal.ts), exercised via the additive
// test-only re-export `__resolveRootTargetForTesting`.
//
// This is the WIRING layer — group addressing → host-side `TerminalRootTarget`
// (`{ rootPath, groupRootPaths? }`). We deliberately do NOT spawn a real PTY
// through `createTerminalSessionInternal`; the resolver/prepare composition is
// what the M9 backfill calls for, and it's fully testable without a daemon.
// (The env half — `groupRootPaths` → `SUPERSET_ROOTS` — is covered separately in
// src/terminal/env.test.ts; this asserts the paths that feed it are collected.)

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import { projects, workspaces } from "../../../db/schema";
import {
	createInMemoryWorkspaceGroupStore,
	getGroupAgentRootPath,
	WorkspaceGroupResolver,
	type WorkspaceGroupStore,
} from "../../../runtime/workspace-groups";
import type { HostServiceContext } from "../../../types";
import { __resolveRootTargetForTesting } from "./terminal.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("terminal resolveRootTarget (rootTarget / agentRoot resolution)", () => {
	let db: HostDb;
	let store: WorkspaceGroupStore;
	let resolver: WorkspaceGroupResolver;
	let ctx: HostServiceContext;
	let targetsDir: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	let projectId: string;
	let worktreePath: string;
	let folderPath: string;

	function makeTargetDir(name: string): string {
		const path = join(targetsDir, name);
		mkdirSync(path, { recursive: true });
		return path;
	}

	beforeEach(() => {
		db = buildDb();
		store = createInMemoryWorkspaceGroupStore();
		resolver = new WorkspaceGroupResolver({ db });
		targetsDir = mkdtempSync(join(tmpdir(), "resolve-root-target-"));
		// Point ~/.superset at a temp dir so the agentRoot prepare lands somewhere
		// disposable.
		homeDir = mkdtempSync(join(tmpdir(), "resolve-root-target-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;

		worktreePath = makeTargetDir("worktree");
		folderPath = makeTargetDir("folder");

		projectId = randomUUID();
		db.insert(projects)
			.values({ id: projectId, repoPath: makeTargetDir("repo-main") })
			.run();

		ctx = {
			isAuthenticated: true,
			workspaceGroupStore: store,
			workspaceGroupResolver: resolver,
		} as unknown as HostServiceContext;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) {
			delete process.env.SUPERSET_HOME_DIR;
		} else {
			process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		}
		rmSync(targetsDir, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function seedWorkspaceRow(worktreePathValue: string): string {
		const id = randomUUID();
		db.insert(workspaces)
			.values({
				id,
				projectId,
				worktreePath: worktreePathValue,
				branch: "feature/x",
			})
			.run();
		return id;
	}

	/** A group with one folder root + one worktree-backed workspace root. */
	function createMixedGroup(): {
		groupId: string;
		folderRootId: string;
		workspaceRootId: string;
	} {
		const workspaceId = seedWorkspaceRow(worktreePath);
		const created = store.create({
			name: "mixed",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath, label: "Folder" },
				{
					kind: "workspace",
					workspaceId,
					folderPath: null,
					label: "Worktree",
				},
			],
		});
		const folderRootId = created.roots.find((r) => r.kind === "folder")?.rootId;
		const workspaceRootId = created.roots.find(
			(r) => r.kind === "workspace",
		)?.rootId;
		if (!folderRootId || !workspaceRootId) {
			throw new Error("expected both roots to have ids");
		}
		return { groupId: created.id, folderRootId, workspaceRootId };
	}

	it("resolves a folder root → cwd = that root's path, no SUPERSET_ROOTS", async () => {
		const { groupId, folderRootId } = createMixedGroup();

		const result = await __resolveRootTargetForTesting(ctx, {
			groupId,
			rootId: folderRootId,
		});

		// cwd is the folder root's resolved path…
		expect(result.rootPath).toBe(folderPath);
		// …and a single-root target carries no group paths (so the PTY env omits
		// SUPERSET_ROOTS — see env.test.ts).
		expect(result.groupRootPaths).toBeUndefined();
	});

	it("resolves a workspace root → cwd = the resolved worktree path", async () => {
		const { groupId, workspaceRootId } = createMixedGroup();

		const result = await __resolveRootTargetForTesting(ctx, {
			groupId,
			rootId: workspaceRootId,
		});

		// The workspaceId was resolved to its worktreePath, not echoed back.
		expect(result.rootPath).toBe(worktreePath);
		expect(result.groupRootPaths).toBeUndefined();
	});

	it("resolves agentRoot → cwd = the prepared agent root dir; groupRootPaths collects every existing root path", async () => {
		const { groupId } = createMixedGroup();

		const result = await __resolveRootTargetForTesting(ctx, {
			groupId,
			agentRoot: true,
		});

		// cwd is the synthetic combined-agent dir for this group…
		expect(result.rootPath).toBe(getGroupAgentRootPath(groupId));
		// …and every existing root path is collected for SUPERSET_ROOTS, in root
		// order (folder first, then worktree).
		expect(result.groupRootPaths).toEqual([folderPath, worktreePath]);
	});

	it("agentRoot excludes a root whose path no longer exists from groupRootPaths", async () => {
		// A folder root + a workspace root whose worktreePath points nowhere.
		const missing = join(targetsDir, "does-not-exist");
		const workspaceId = seedWorkspaceRow(missing);
		const created = store.create({
			name: "with-missing",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath, label: "Folder" },
				{
					kind: "workspace",
					workspaceId,
					folderPath: null,
					label: "Gone",
				},
			],
		});

		const result = await __resolveRootTargetForTesting(ctx, {
			groupId: created.id,
			agentRoot: true,
		});

		expect(result.rootPath).toBe(getGroupAgentRootPath(created.id));
		// Only the still-present folder root contributes to SUPERSET_ROOTS.
		expect(result.groupRootPaths).toEqual([folderPath]);
	});

	it("throws NOT_FOUND for an unknown group", async () => {
		await expect(
			__resolveRootTargetForTesting(ctx, {
				groupId: "no-such-group",
				agentRoot: true,
			}),
		).rejects.toThrow(/not found/i);
	});

	it("throws NOT_FOUND for an unknown rootId within a known group", async () => {
		const { groupId } = createMixedGroup();
		await expect(
			__resolveRootTargetForTesting(ctx, {
				groupId,
				rootId: "no-such-root",
			}),
		).rejects.toThrow(/not found/i);
	});

	it("throws NOT_FOUND for a root that resolves to a missing path", async () => {
		const missing = join(targetsDir, "vanished");
		const workspaceId = seedWorkspaceRow(missing);
		const created = store.create({
			name: "missing-root",
			roots: [
				{ kind: "workspace", workspaceId, folderPath: null, label: "Gone" },
			],
		});
		const rootId = created.roots[0]?.rootId;
		if (!rootId) throw new Error("expected a root id");

		await expect(
			__resolveRootTargetForTesting(ctx, { groupId: created.id, rootId }),
		).rejects.toThrow(/does not resolve/i);
	});
});
