import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import {
	createInMemoryWorkspaceGroupStore,
	WorkspaceGroupResolver,
	type WorkspaceGroupStore,
} from "../workspace-groups/index.ts";
import { WorkspaceFilesystemManager } from "./filesystem.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

/**
 * Verifies the seam the group-addressed `searchFiles`/`searchContent` tRPC
 * procedures route through: `getServiceForRootId({ groupId, rootId })` resolves
 * a group root (including a `kind: "folder"` root with no workspaceId) to the
 * FS service rooted at that root's path, so a single-root search is addressable
 * by `{ groupId, rootId }`.
 */
describe("WorkspaceFilesystemManager.getServiceForRootId (group search addressing)", () => {
	let tmpRoot: string;
	let folderA: string;
	let folderB: string;
	let store: WorkspaceGroupStore;
	let manager: WorkspaceFilesystemManager;

	function buildDb(): HostDb {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		return db as unknown as HostDb;
	}

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "group-search-test-"));
		folderA = join(tmpRoot, "folder-a");
		folderB = join(tmpRoot, "folder-b");
		mkdirSync(folderA, { recursive: true });
		mkdirSync(folderB, { recursive: true });
		writeFileSync(join(folderA, "only-in-a.txt"), "alpha contents\n");
		writeFileSync(join(folderB, "only-in-b.txt"), "beta contents\n");

		const db = buildDb();
		store = createInMemoryWorkspaceGroupStore();
		const resolver = new WorkspaceGroupResolver({ db });
		manager = new WorkspaceFilesystemManager({
			db,
			workspaceGroupStore: store,
			workspaceGroupResolver: resolver,
		});
	});

	afterEach(async () => {
		await manager.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("routes searchFiles to the addressed root only", async () => {
		const group = store.create({
			name: "two folders",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: folderA, label: "A" },
				{ kind: "folder", workspaceId: null, folderPath: folderB, label: "B" },
			],
		});
		const rootAId = group.roots[0]?.rootId as string;
		const rootBId = group.roots[1]?.rootId as string;

		const serviceA = manager.getServiceForRootId({
			groupId: group.id,
			rootId: rootAId,
		});
		const serviceB = manager.getServiceForRootId({
			groupId: group.id,
			rootId: rootBId,
		});

		const aResults = await serviceA.searchFiles({ query: "only-in" });
		const aPaths = aResults.matches.map((m) => m.absolutePath);
		expect(aPaths.some((p) => p.endsWith("only-in-a.txt"))).toBe(true);
		expect(aPaths.some((p) => p.endsWith("only-in-b.txt"))).toBe(false);

		const bResults = await serviceB.searchFiles({ query: "only-in" });
		const bPaths = bResults.matches.map((m) => m.absolutePath);
		expect(bPaths.some((p) => p.endsWith("only-in-b.txt"))).toBe(true);
		expect(bPaths.some((p) => p.endsWith("only-in-a.txt"))).toBe(false);
	});

	it("throws NOT_FOUND-style errors for an unknown group or root", () => {
		expect(() =>
			manager.getServiceForRootId({ groupId: "nope", rootId: "x" }),
		).toThrow("Workspace group not found:");

		const group = store.create({
			name: "g",
			roots: [
				{ kind: "folder", workspaceId: null, folderPath: folderA, label: "A" },
			],
		});
		expect(() =>
			manager.getServiceForRootId({ groupId: group.id, rootId: "missing" }),
		).toThrow("not found in group");
	});
});
