import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { WorkspaceGroupResolver } from "./resolve";
import { createSqliteWorkspaceGroupStore } from "./sqlite-store";
import type { WorkspaceGroupStore } from "./store";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");
const PROJECT_ID = "1f0e8c7e-1234-4abc-8def-0123456789ab";
const WORKSPACE_B = "3f0e8c7e-1234-4abc-8def-0123456789ab";

// bun:sqlite stands in for better-sqlite3 here (the production driver isn't
// loadable under Bun), mirroring the existing host-service router tests; the
// drivers are runtime-compatible so the db is cast to HostDb. The migrations
// folder is the same one `migrate(...)` applies on host startup, so the test
// exercises the exact 0006 schema that ships.
function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("createSqliteWorkspaceGroupStore", () => {
	let db: HostDb;
	let store: WorkspaceGroupStore;

	beforeEach(() => {
		db = buildDb();
		store = createSqliteWorkspaceGroupStore(db);
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("creates a group with normalized positions and a null default root", () => {
		const group = store.create({
			name: "My group",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/a", label: "a" },
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/b", label: "b" },
			],
		});

		expect(group.name).toBe("My group");
		expect(group.defaultRootId).toBeNull();
		expect(group.roots).toHaveLength(2);
		expect(group.roots[0]?.position).toBe(0);
		expect(group.roots[1]?.position).toBe(1);
		expect(group.roots[0]?.rootId).toBeTruthy();
		expect(group.roots[0]?.rootId).not.toBe(group.roots[1]?.rootId);
		// A fresh get (re-read from SQLite) returns the same persisted group.
		const reread = store.get(group.id);
		expect(reread?.roots).toHaveLength(2);
		expect(reread?.roots.map((r) => r.label)).toEqual(["a", "b"]);
	});

	it("addRoot appends with the next position; reorderRoots re-stamps positions in order, and get returns roots in order", () => {
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

		const idA = afterA.roots[0]?.rootId as string;
		const idB = afterB.roots[1]?.rootId as string;
		expect(idA).toBeTruthy();
		expect(idB).toBeTruthy();

		const reordered = store.reorderRoots({
			id: created.id,
			orderedRootIds: [idB, idA],
		});
		expect(reordered.roots.map((r) => r.label)).toEqual(["B", "A"]);
		expect(reordered.roots.map((r) => r.position)).toEqual([0, 1]);

		// get re-reads ordered by position and returns the reordered roots.
		const reread = store.get(created.id);
		expect(reread?.roots.map((r) => r.label)).toEqual(["B", "A"]);
		expect(reread?.roots.map((r) => r.position)).toEqual([0, 1]);
	});

	it("setDefaultRoot stores the pointer and removeRoot clears a dangling default and re-stamps positions", () => {
		const created = store.create({
			name: "g",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/a", label: "A" },
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/b", label: "B" },
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/c", label: "C" },
			],
		});
		const idA = created.roots[0]?.rootId as string;
		const idB = created.roots[1]?.rootId as string;

		const withDefault = store.setDefaultRoot({ id: created.id, rootId: idA });
		expect(withDefault.defaultRootId).toBe(idA);
		expect(store.get(created.id)?.defaultRootId).toBe(idA);

		// Removing the default root clears the pointer and re-stamps positions.
		const afterRemove = store.removeRoot({ id: created.id, rootId: idA });
		expect(afterRemove.defaultRootId).toBeNull();
		expect(afterRemove.roots.map((r) => r.label)).toEqual(["B", "C"]);
		expect(afterRemove.roots.map((r) => r.position)).toEqual([0, 1]);

		// Removing a non-default root leaves the default pointer intact.
		store.setDefaultRoot({ id: created.id, rootId: idB });
		const afterRemoveC = store.removeRoot({
			id: created.id,
			rootId: afterRemove.roots[1]?.rootId as string,
		});
		expect(afterRemoveC.defaultRootId).toBe(idB);
		expect(afterRemoveC.roots.map((r) => r.label)).toEqual(["B"]);
	});

	it("throws on reorder with a missing or extra root id; throws on set-default for a foreign root", () => {
		const created = store.create({
			name: "g",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/a", label: "A" },
			],
		});
		expect(() =>
			store.reorderRoots({ id: created.id, orderedRootIds: ["nope"] }),
		).toThrow();
		expect(() =>
			store.setDefaultRoot({ id: created.id, rootId: "nope" }),
		).toThrow();
	});

	it("delete removes the group (cascading its roots); list reflects current groups in created order", () => {
		const a = store.create({
			name: "a",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/a", label: "A" },
			],
		});
		const b = store.create({ name: "b", roots: [] });
		expect(store.list().map((g) => g.id)).toEqual([a.id, b.id]);

		store.delete(a.id);
		expect(store.get(a.id)).toBeNull();
		expect(store.list().map((g) => g.id)).toEqual([b.id]);

		// Cascade: the deleted group's roots are gone from the roots table.
		const orphanRoots = db.select().from(schema.workspaceGroupRoots).all();
		expect(orphanRoots).toHaveLength(0);
	});

	it("workspace-root cascade: deleting the underlying workspace row removes the root", () => {
		db.insert(schema.projects)
			.values({ id: PROJECT_ID, repoPath: "/tmp/repo" })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: WORKSPACE_B,
				projectId: PROJECT_ID,
				worktreePath: "/tmp/worktree-b",
				branch: "main",
			})
			.run();

		const created = store.create({
			name: "with-workspace",
			roots: [
				{
					kind: "workspace",
					workspaceId: WORKSPACE_B,
					folderPath: null,
					label: "Workspace B",
				},
			],
		});
		expect(store.get(created.id)?.roots).toHaveLength(1);

		// Deleting the workspace cascades to its group root.
		db.delete(schema.workspaces)
			.where(eq(schema.workspaces.id, WORKSPACE_B))
			.run();
		expect(store.get(created.id)?.roots).toHaveLength(0);
		// The group itself survives.
		expect(store.get(created.id)?.name).toBe("with-workspace");
	});

	it("reconcile-on-read: a workspace-root cascade that drops the default leaves defaultRootId null on get/list/resolve", () => {
		db.insert(schema.projects)
			.values({ id: PROJECT_ID, repoPath: "/tmp/repo" })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: WORKSPACE_B,
				projectId: PROJECT_ID,
				worktreePath: "/tmp/worktree-b",
				branch: "main",
			})
			.run();

		const created = store.create({
			name: "with-default",
			roots: [
				{
					kind: "workspace",
					workspaceId: WORKSPACE_B,
					folderPath: null,
					label: "Workspace B",
				},
			],
		});
		const workspaceRootId = created.roots[0]?.rootId as string;

		// Point the group's default at the workspace root.
		store.setDefaultRoot({ id: created.id, rootId: workspaceRootId });
		expect(store.get(created.id)?.defaultRootId).toBe(workspaceRootId);

		// Delete the underlying workspace row: the FK cascades the ROOT out of
		// workspace_group_roots, but default_root_id is plain text (no self-FK), so
		// the raw column is left DANGLING (still pointing at the removed rootId).
		db.delete(schema.workspaces)
			.where(eq(schema.workspaces.id, WORKSPACE_B))
			.run();
		const rawRow = db
			.select()
			.from(schema.workspaceGroups)
			.where(eq(schema.workspaceGroups.id, created.id))
			.get();
		expect(rawRow?.defaultRootId).toBe(workspaceRootId); // genuinely dangling on disk
		expect(db.select().from(schema.workspaceGroupRoots).all()).toHaveLength(0); // root really cascaded away

		// get / list reconcile the dangling pointer to null.
		const fetched = store.get(created.id);
		expect(fetched?.roots).toHaveLength(0);
		expect(fetched?.defaultRootId).toBeNull();
		expect(
			store.list().find((g) => g.id === created.id)?.defaultRootId,
		).toBeNull();

		// resolveGroup (the router's get/list/prepareAgentRoot path) also nulls it.
		const resolver = new WorkspaceGroupResolver({ db });
		const group = store.get(created.id);
		if (!group) {
			throw new Error("expected group to exist");
		}
		expect(resolver.resolveGroup(group).defaultRootId).toBeNull();
	});

	it("rename and unknown-id lookups behave like the in-memory store", () => {
		const created = store.create({ name: "old", roots: [] });
		const renamed = store.rename({ id: created.id, name: "new" });
		expect(renamed.name).toBe("new");
		expect(store.get(created.id)?.name).toBe("new");

		expect(store.get("missing")).toBeNull();
		expect(() => store.rename({ id: "missing", name: "x" })).toThrow();
		expect(() =>
			store.addRoot({
				id: "missing",
				root: {
					kind: "folder",
					workspaceId: null,
					folderPath: "/x",
					label: "x",
				},
			}),
		).toThrow();
	});

	it("persists across a fresh store instance over the same db (restart simulation)", () => {
		const created = store.create({
			name: "durable",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/a", label: "A" },
				{ kind: "folder", workspaceId: null, folderPath: "/tmp/b", label: "B" },
			],
		});
		store.setDefaultRoot({
			id: created.id,
			rootId: created.roots[0]?.rootId as string,
		});

		// A new store reading the same db sees the persisted group + roots + default.
		const reopened = createSqliteWorkspaceGroupStore(db);
		const group = reopened.get(created.id);
		expect(group?.name).toBe("durable");
		expect(group?.roots.map((r) => r.label)).toEqual(["A", "B"]);
		expect(group?.defaultRootId).toBe(created.roots[0]?.rootId);
	});

	it("get returns resolved-ready roots in order for the router resolver", () => {
		const resolver = new WorkspaceGroupResolver({ db });
		const created = store.create({
			name: "mixed",
			roots: [
				{
					kind: "folder",
					workspaceId: null,
					folderPath: "/tmp/folder-a",
					label: "Folder A",
				},
			],
		});
		const group = store.get(created.id);
		if (!group) {
			throw new Error("expected group to exist");
		}
		const resolved = resolver.resolveGroup(group);
		expect(resolved.roots.map((r) => r.label)).toEqual(["Folder A"]);
		expect(resolved.roots[0]?.rootPath).toBe("/tmp/folder-a");
	});
});
