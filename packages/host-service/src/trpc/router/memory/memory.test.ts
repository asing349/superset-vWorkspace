import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import { projects } from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { memoryRouter } from "./memory";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("memoryRouter (B1 CRUD)", () => {
	let db: HostDb;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "project-1";

	beforeEach(() => {
		db = buildDb();
		// A real project row so the FK on memory_playbooks.project_id is satisfied.
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/repo" }).run();
		homeDir = mkdtempSync(join(tmpdir(), "memory-home-"));
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
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		const ctx = {
			db,
			isAuthenticated: true,
		} as unknown as HostServiceContext;
		return memoryRouter.createCaller(ctx);
	}

	it("captures a provisional playbook, deriving area tags and redacting secrets", async () => {
		const c = caller();
		const playbook = await c.capture({
			projectId,
			intent: `Add memory router; token=ghp_${"a".repeat(36)}`,
			touchedPaths: [
				"packages/host-service/src/trpc/router/memory/memory.ts",
				"packages/db/src/schema/users.ts",
			],
			commands: ["bun test packages/host-service"],
			gotcha: null,
			diffShape: null,
			validation: "host-service suite green",
			provenance: { prNumber: 42, url: null, taskId: null },
		});

		expect(playbook.status).toBe("provisional");
		expect(playbook.confidence).toBe(0);
		// Secret in the intent is scrubbed.
		expect(playbook.intent).not.toContain("a".repeat(36));
		// Area tags derived from touched paths (multi-label).
		expect(playbook.areaTags).toContain("backend");
		expect(playbook.areaTags).toContain("schema");
		expect(playbook.provenance.prNumber).toBe(42);
	});

	it("lists and filters playbooks by status", async () => {
		const c = caller();
		const p = await c.capture({
			projectId,
			intent: "task A",
			touchedPaths: [],
		});
		await c.capture({ projectId, intent: "task B", touchedPaths: [] });

		const all = await c.listPlaybooks({ projectId });
		expect(all).toHaveLength(2);

		await c.confirm({ id: p.id, confidence: 90 });
		const confirmed = await c.listPlaybooks({ projectId, status: "confirmed" });
		expect(confirmed).toHaveLength(1);
		expect(confirmed[0]?.id).toBe(p.id);
		expect(confirmed[0]?.confidence).toBe(90);
	});

	it("confirms, demotes, and forgets a playbook", async () => {
		const c = caller();
		const p = await c.capture({ projectId, intent: "x", touchedPaths: [] });

		const confirmed = await c.confirm({ id: p.id });
		expect(confirmed.status).toBe("confirmed");
		expect(confirmed.confidence).toBe(80);

		const demoted = await c.demote({ id: p.id });
		expect(demoted.status).toBe("demoted");
		expect(demoted.confidence).toBe(0);

		const forgotten = await c.forget({ id: p.id });
		expect(forgotten.forgotten).toBe(true);
		await expect(c.getPlaybook({ id: p.id })).rejects.toThrow();
	});

	it("tombstones on forget when asked", async () => {
		const c = caller();
		const p = await c.capture({ projectId, intent: "y", touchedPaths: [] });
		await c.forget({ id: p.id, tombstone: true });
		const row = await c.getPlaybook({ id: p.id });
		expect(row.status).toBe("archived");
	});

	it("getPractice returns a doc with null latest when none exists", async () => {
		const c = caller();
		const doc = await c.getPractice({ scope: "project", projectId });
		expect(doc.scope).toBe("project");
		expect(doc.latest).toBeNull();
	});

	it("records and reads telemetry", async () => {
		const c = caller();
		await c.telemetry.record({
			projectId,
			metric: "tokens",
			baselineValue: 1000,
			observedValue: 600,
		});
		const samples = await c.telemetry.read({ projectId });
		expect(samples).toHaveLength(1);
		expect(samples[0]?.observedValue).toBe(600);
	});

	it("stubs return typed not-implemented shapes without throwing", async () => {
		const c = caller();
		const idx = await c.indexStatus({ projectId });
		expect(idx).toEqual({ implemented: false, milestone: "B3" });
		const reindex = await c.reindex({ projectId });
		expect(reindex.milestone).toBe("B3");
		const consolidate = await c.consolidatePractice({
			scope: "project",
			projectId,
		});
		expect(consolidate.milestone).toBe("B5");
		const retrieved = await c.retrieve({ projectId, intent: "x" });
		expect(retrieved.implemented).toBe(false);
		expect(retrieved.playbooks).toEqual([]);
	});
});
