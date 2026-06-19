import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { WorkspaceGroupResolver } from "./resolve";
import {
	createInMemoryWorkspaceGroupStore,
	type WorkspaceGroupStore,
} from "./store";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");
const PROJECT_ID = "1f0e8c7e-1234-4abc-8def-0123456789ab";
const WORKSPACE_A = "2f0e8c7e-1234-4abc-8def-0123456789ab";
const WORKSPACE_B = "3f0e8c7e-1234-4abc-8def-0123456789ab";

describe("createInMemoryWorkspaceGroupStore", () => {
	let store: WorkspaceGroupStore;

	beforeEach(() => {
		store = createInMemoryWorkspaceGroupStore();
	});

	it("creates a group with normalized positions and a null default root", () => {
		const group = store.create({
			name: "My group",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/a",
					label: "a",
				},
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/b",
					label: "b",
				},
			],
		});

		expect(group.name).toBe("My group");
		expect(group.defaultRootId).toBeNull();
		expect(group.roots).toHaveLength(2);
		expect(group.roots[0]?.position).toBe(0);
		expect(group.roots[1]?.position).toBe(1);
		// rootIds are assigned and unique.
		expect(group.roots[0]?.rootId).toBeTruthy();
		expect(group.roots[0]?.rootId).not.toBe(group.roots[1]?.rootId);
		// get returns an equivalent (cloned) group.
		expect(store.get(group.id)?.roots).toHaveLength(2);
	});

	it("addRoot appends with the next position; reorderRoots re-stamps positions in order", () => {
		const created = store.create({ name: "g", roots: [] });

		const afterA = store.addRoot({
			id: created.id,
			root: {
				kind: "folder",
				workspaceId: null,
				folderPath: "/tmp/a",
				label: "A",
			},
		});
		const afterB = store.addRoot({
			id: created.id,
			root: {
				kind: "folder",
				workspaceId: null,
				folderPath: "/tmp/b",
				label: "B",
			},
		});

		expect(afterB.roots.map((r) => r.label)).toEqual(["A", "B"]);
		expect(afterB.roots.map((r) => r.position)).toEqual([0, 1]);

		const idA = afterA.roots[0]?.rootId;
		const idB = afterB.roots[1]?.rootId;
		expect(idA).toBeDefined();
		expect(idB).toBeDefined();

		const reordered = store.reorderRoots({
			id: created.id,
			orderedRootIds: [idB as string, idA as string],
		});

		expect(reordered.roots.map((r) => r.label)).toEqual(["B", "A"]);
		expect(reordered.roots.map((r) => r.position)).toEqual([0, 1]);
	});

	it("setDefaultRoot stores the pointer and removeRoot clears a dangling default", () => {
		const created = store.create({
			name: "g",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/a",
					label: "A",
				},
			],
		});
		const rootId = created.roots[0]?.rootId as string;

		const withDefault = store.setDefaultRoot({ id: created.id, rootId });
		expect(withDefault.defaultRootId).toBe(rootId);

		const afterRemove = store.removeRoot({ id: created.id, rootId });
		expect(afterRemove.roots).toHaveLength(0);
		expect(afterRemove.defaultRootId).toBeNull();
	});

	it("throws on reorder with a missing or extra root id", () => {
		const created = store.create({
			name: "g",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/a",
					label: "A",
				},
			],
		});
		expect(() =>
			store.reorderRoots({ id: created.id, orderedRootIds: ["nope"] }),
		).toThrow();
	});

	it("delete removes the group; list reflects current groups", () => {
		const a = store.create({ name: "a", roots: [] });
		const b = store.create({ name: "b", roots: [] });
		expect(store.list()).toHaveLength(2);
		store.delete(a.id);
		expect(store.get(a.id)).toBeNull();
		expect(store.list().map((g) => g.id)).toEqual([b.id]);
	});

	it("mutating a returned group does not mutate stored state", () => {
		const created = store.create({
			name: "g",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/a",
					label: "A",
				},
			],
		});
		const returned = store.get(created.id);
		expect(returned).not.toBeNull();
		if (returned) {
			returned.name = "MUTATED";
			const firstRoot = returned.roots[0];
			if (firstRoot) {
				firstRoot.label = "MUTATED";
			}
		}
		const reread = store.get(created.id);
		expect(reread?.name).toBe("g");
		expect(reread?.roots[0]?.label).toBe("A");
	});
});

describe("WorkspaceGroupResolver + store: get returns resolved roots in order", () => {
	let tmpRoot: string;
	let folderPathA: string;
	let worktreePathB: string;

	// bun:sqlite stands in for better-sqlite3 here (the production driver isn't
	// loadable under Bun), mirroring the existing host-service router tests; the
	// drivers are runtime-compatible so the db is cast to HostDb.
	function buildDb(): HostDb {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		db.insert(schema.projects)
			.values({ id: PROJECT_ID, repoPath: tmpRoot })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: WORKSPACE_B,
				projectId: PROJECT_ID,
				worktreePath: worktreePathB,
				branch: "main",
			})
			.run();
		return db as unknown as HostDb;
	}

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "workspace-group-resolver-test-"));
		folderPathA = join(tmpRoot, "folder-a");
		worktreePathB = join(tmpRoot, "worktree-b");
		mkdirSync(folderPathA, { recursive: true });
		mkdirSync(worktreePathB, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("resolves a folder root and a workspace root to absolute paths in array order", () => {
		const store = createInMemoryWorkspaceGroupStore();
		const db = buildDb();
		const resolver = new WorkspaceGroupResolver({ db });

		// create with the folder root, then add the workspace root, then reorder
		// so the workspace root comes first.
		const created = store.create({
			name: "mixed",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: folderPathA,
					label: "Folder A",
				},
			],
		});
		const afterAdd = store.addRoot({
			id: created.id,
			root: {
				kind: "workspace",
				workspaceId: WORKSPACE_B,
				folderPath: null,
				label: "Workspace B",
			},
		});
		const folderRootId = created.roots[0]?.rootId as string;
		const workspaceRootId = afterAdd.roots[1]?.rootId as string;

		store.reorderRoots({
			id: created.id,
			orderedRootIds: [workspaceRootId, folderRootId],
		});

		// Mirror the router's `get`: read store group, resolve through resolver.
		const group = store.get(created.id);
		if (!group) {
			throw new Error("expected group to exist");
		}
		const resolved = resolver.resolveGroup(group);

		expect(resolved.roots.map((r) => r.label)).toEqual([
			"Workspace B",
			"Folder A",
		]);
		expect(resolved.roots.map((r) => r.position)).toEqual([0, 1]);
		expect(resolved.roots[0]?.rootPath).toBe(worktreePathB);
		expect(resolved.roots[0]?.exists).toBe(true);
		expect(resolved.roots[1]?.rootPath).toBe(folderPathA);
		expect(resolved.roots[1]?.exists).toBe(true);
	});

	it("marks an unresolvable workspace root as not existing instead of throwing", () => {
		const store = createInMemoryWorkspaceGroupStore();
		const db = buildDb();
		const resolver = new WorkspaceGroupResolver({ db });

		const created = store.create({
			name: "stale",
			roots: [
				{
					kind: "workspace",
					workspaceId: WORKSPACE_A, // no such workspaces row
					folderPath: null,
					label: "Missing",
				},
			],
		});

		const group = store.get(created.id);
		if (!group) {
			throw new Error("expected group to exist");
		}
		const resolved = resolver.resolveGroup(group);
		expect(resolved.roots[0]?.rootPath).toBe("");
		expect(resolved.roots[0]?.exists).toBe(false);
	});
});
