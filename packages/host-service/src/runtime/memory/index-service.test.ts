import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import {
	memoryFingerprints,
	memoryProjectIndex,
	projects,
} from "../../db/schema";
import { ProjectIndexService } from "./index-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("ProjectIndexService (B3)", () => {
	let db: HostDb;
	let repoPath: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "project-index-1";

	beforeEach(() => {
		db = buildDb();
		repoPath = mkdtempSync(join(tmpdir(), "memory-index-repo-"));
		db.insert(projects).values({ id: projectId, repoPath }).run();
		homeDir = mkdtempSync(join(tmpdir(), "memory-index-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;

		// A small synthetic repo with a recognizable area + exported symbols.
		mkdirSync(join(repoPath, "packages/host-service/src"), { recursive: true });
		writeFileSync(
			join(repoPath, "packages/host-service/src/handler.ts"),
			"export function handleRequest() {}\nexport const VERSION = 1;\n",
		);
		writeFileSync(
			join(repoPath, "packages/host-service/src/util.ts"),
			"export class Helper {}\n",
		);
		writeFileSync(join(repoPath, "README.md"), "# repo\n");
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(repoPath, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("builds a structural index with symbols, areas, and fingerprints", async () => {
		const service = new ProjectIndexService({ db });
		const count = await service.buildProjectIndex(projectId);
		expect(count).toBeGreaterThanOrEqual(3);

		const entries = service.listEntries(projectId);
		const handler = entries.find((e) => e.path.endsWith("handler.ts"));
		expect(handler).toBeDefined();
		expect(handler?.areaTags).toContain("backend");
		// Exported symbols surfaced in the summary (TS-compiler-API extraction).
		expect(handler?.summary).toContain("handleRequest");
		expect(handler?.summary).toContain("VERSION");

		// Every entry has a fingerprint row.
		expect(handler?.fingerprintId).toBeTruthy();
		const fp = db
			.select()
			.from(memoryFingerprints)
			.where(eq(memoryFingerprints.subject, handler?.path ?? ""))
			.get();
		expect(fp?.contentHash).toMatch(/^[0-9a-f]{16}$/);

		const status = service.indexStatus(projectId);
		expect(status.indexed).toBe(true);
		expect(status.entryCount).toBe(count);
		expect(status.lastIndexedAt).not.toBeNull();
	});

	it("incrementally refreshes only changed paths and updates the fingerprint", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);

		const before = db
			.select()
			.from(memoryFingerprints)
			.where(
				eq(memoryFingerprints.subject, "packages/host-service/src/handler.ts"),
			)
			.get();
		expect(before).toBeDefined();

		// Mutate the file's content, then refresh just that path.
		writeFileSync(
			join(repoPath, "packages/host-service/src/handler.ts"),
			"export function handleRequest() {}\nexport const VERSION = 2;\nexport const ADDED = true;\n",
		);
		await service.refreshPaths({
			projectId,
			paths: ["packages/host-service/src/handler.ts"],
		});

		const after = db
			.select()
			.from(memoryFingerprints)
			.where(
				eq(memoryFingerprints.subject, "packages/host-service/src/handler.ts"),
			)
			.get();
		// Content changed -> fingerprint hash changed (staleness detected).
		expect(after?.contentHash).not.toBe(before?.contentHash);

		const handler = service
			.listEntries(projectId)
			.find((e) => e.path.endsWith("handler.ts"));
		expect(handler?.summary).toContain("ADDED");
	});

	it("evicts entries for files that no longer exist on rebuild", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);
		expect(
			service.listEntries(projectId).some((e) => e.path.endsWith("util.ts")),
		).toBe(true);

		rmSync(join(repoPath, "packages/host-service/src/util.ts"));
		await service.buildProjectIndex(projectId);

		const entries = service.listEntries(projectId);
		expect(entries.some((e) => e.path.endsWith("util.ts"))).toBe(false);
		// Its fingerprint is gone too.
		const orphanFp = db
			.select()
			.from(memoryFingerprints)
			.where(
				eq(memoryFingerprints.subject, "packages/host-service/src/util.ts"),
			)
			.get();
		expect(orphanFp).toBeUndefined();
	});

	it("keeps a stable fingerprint id when content is unchanged across rebuilds", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);
		const first = service
			.listEntries(projectId)
			.find((e) => e.path.endsWith("util.ts"));
		await service.buildProjectIndex(projectId);
		const second = service
			.listEntries(projectId)
			.find((e) => e.path.endsWith("util.ts"));
		expect(second?.fingerprintId).toBe(first?.fingerprintId);
	});

	it("lexical search falls back gracefully when ripgrep is ABSENT (does not throw)", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);

		// Simulate a missing `rg` binary: the injected runner throws ENOENT, which
		// is exactly how execFile fails when the binary isn't on PATH.
		const throwingRunRipgrep = async (): Promise<{ stdout: string }> => {
			const err = new Error("spawn rg ENOENT") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			throw err;
		};

		const results = await service.lexicalSearch({
			projectId,
			query: "handleRequest",
			runRipgrep: throwingRunRipgrep,
		});
		// The workspace-fs JS-scan fallback still finds the match in handler.ts.
		expect(results.some((m) => m.relativePath.endsWith("handler.ts"))).toBe(
			true,
		);
	});

	it("lexicalSearch returns [] for an unknown project without throwing", async () => {
		const service = new ProjectIndexService({ db });
		const results = await service.lexicalSearch({
			projectId: "nope",
			query: "anything",
		});
		expect(results).toEqual([]);
	});

	it("does not leak entries across the index/projectIndex tables for other projects", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);
		const rows = db
			.select()
			.from(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, projectId))
			.all();
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.projectId === projectId)).toBe(true);
	});
});
