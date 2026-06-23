import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db/index.ts";
import * as schema from "../db/schema";
import { terminalSessions } from "../db/schema";
import { rebuildRespawnTargetFromRow } from "./terminal.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

/**
 * Wave-4 A3: workspace-LESS group/folder terminals are now respawnable (not
 * only adoptable) after a host restart, by persisting their root path / group
 * roots / cwd on the `terminal_sessions` row and rebuilding the launch target
 * from it. These tests cover the pure rebuild mapping + that the new columns
 * persist (which also proves the 0009 migration applies to a fresh db).
 */
describe("rebuildRespawnTargetFromRow (Wave-4 A3)", () => {
	it("returns null when the row has no persisted rootPath (pre-A3 / workspace row)", () => {
		expect(
			rebuildRespawnTargetFromRow({
				rootPath: null,
				groupRootPathsJson: null,
				cwd: null,
			}),
		).toBeNull();
	});

	it("rebuilds a single-root folder target", () => {
		const result = rebuildRespawnTargetFromRow({
			rootPath: "/work/repo-a",
			groupRootPathsJson: null,
			cwd: "/work/repo-a/src",
		});
		expect(result).toEqual({
			rootTarget: { rootPath: "/work/repo-a" },
			cwd: "/work/repo-a/src",
		});
	});

	it("rebuilds a combined-agent-root target with SUPERSET_ROOTS group paths", () => {
		const result = rebuildRespawnTargetFromRow({
			rootPath: "/work/.agent-root",
			groupRootPathsJson: JSON.stringify(["/work/repo-a", "/work/repo-b"]),
			cwd: null,
		});
		expect(result).toEqual({
			rootTarget: {
				rootPath: "/work/.agent-root",
				groupRootPaths: ["/work/repo-a", "/work/repo-b"],
			},
			cwd: undefined,
		});
	});

	it("degrades to a single-root target when groupRootPathsJson is malformed", () => {
		const result = rebuildRespawnTargetFromRow({
			rootPath: "/work/repo-a",
			groupRootPathsJson: "{not valid json",
			cwd: null,
		});
		expect(result).toEqual({
			rootTarget: { rootPath: "/work/repo-a" },
			cwd: undefined,
		});
	});

	it("ignores a non-string-array groupRootPathsJson", () => {
		const result = rebuildRespawnTargetFromRow({
			rootPath: "/work/repo-a",
			groupRootPathsJson: JSON.stringify([1, 2, 3]),
			cwd: null,
		});
		expect(result?.rootTarget).toEqual({ rootPath: "/work/repo-a" });
	});
});

describe("terminal_sessions respawn columns (Wave-4 A3 schema)", () => {
	let db: HostDb;

	beforeEach(() => {
		const sqlite = new Database(":memory:");
		sqlite.exec("PRAGMA foreign_keys = ON;");
		db = drizzle(sqlite, { schema }) as unknown as HostDb;
		// Applies ALL migrations incl. 0009 — proves it lands on a fresh db.
		migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("persists rootPath / groupRootPathsJson / cwd and rebuilds them", () => {
		db.insert(terminalSessions)
			.values({
				id: "term-1",
				originWorkspaceId: null,
				status: "active",
				rootPath: "/work/.agent-root",
				groupRootPathsJson: JSON.stringify(["/work/repo-a", "/work/repo-b"]),
				cwd: "/work/.agent-root",
			})
			.run();

		const row = db.query.terminalSessions
			.findFirst({ where: eq(terminalSessions.id, "term-1") })
			.sync();
		expect(row).toBeDefined();
		expect(row?.rootPath).toBe("/work/.agent-root");

		const respawn = rebuildRespawnTargetFromRow({
			rootPath: row?.rootPath ?? null,
			groupRootPathsJson: row?.groupRootPathsJson ?? null,
			cwd: row?.cwd ?? null,
		});
		expect(respawn?.rootTarget.groupRootPaths).toEqual([
			"/work/repo-a",
			"/work/repo-b",
		]);
		expect(respawn?.cwd).toBe("/work/.agent-root");
	});

	it("leaves the respawn columns null for a workspace session row", () => {
		db.insert(terminalSessions)
			.values({ id: "term-2", originWorkspaceId: null, status: "active" })
			.run();
		const row = db.query.terminalSessions
			.findFirst({ where: eq(terminalSessions.id, "term-2") })
			.sync();
		expect(row?.rootPath ?? null).toBeNull();
		expect(row?.groupRootPathsJson ?? null).toBeNull();
		expect(row?.cwd ?? null).toBeNull();
	});
});
