import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import { projects, workspaces } from "../../../db/schema";
import {
	MemoryConsolidationService,
	MemoryRetrieveService,
	ProjectIndexService,
} from "../../../runtime/memory";
import type { HostServiceContext } from "../../../types";
import { memoryRouter } from "./memory";

/**
 * Minimal `SimpleGit` fake for `captureFromPR`: returns a name-status / numstat
 * for `git diff` invocations and throws otherwise, so `resolveBaseComparison`
 * degrades to the `HEAD~1...HEAD` fallback while the diff still yields files.
 */
function fakeGit() {
	const NUL = "\0";
	return {
		raw: async (args: string[]) => {
			if (args[0] === "diff" && args.includes("--name-status")) {
				// "M\0packages/host-service/src/app.ts\0A\0apps/web/src/new.ts\0"
				return [
					"M",
					"packages/host-service/src/app.ts",
					"A",
					"apps/web/src/new.ts",
					"",
				].join(NUL);
			}
			if (args[0] === "diff" && args.includes("--numstat")) {
				return [
					"10\t2\tpackages/host-service/src/app.ts",
					"40\t0\tapps/web/src/new.ts",
					"",
				].join(NUL);
			}
			throw new Error("not supported in fake");
		},
	};
}

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
	let repoDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "project-1";

	beforeEach(() => {
		db = buildDb();
		// A real (TEMP) repo dir so B5 acceptPractice writes the project AGENTS.md
		// into a sandbox, never the real repo.
		repoDir = mkdtempSync(join(tmpdir(), "memory-repo-"));
		db.insert(projects).values({ id: projectId, repoPath: repoDir }).run();
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
		rmSync(repoDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		const ctx = {
			db,
			isAuthenticated: true,
			git: async () => fakeGit(),
			runtime: {
				memoryIndex: new ProjectIndexService({ db }),
				memoryRetrieve: new MemoryRetrieveService({ db }),
				memoryConsolidation: new MemoryConsolidationService({ db }),
			},
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

	it("captureFromPR distills a provisional playbook from the LOCAL git diff", async () => {
		const c = caller();
		db.insert(workspaces)
			.values({
				id: "ws-1",
				projectId,
				worktreePath: "/tmp/repo/.worktrees/feat",
				branch: "feat",
			})
			.run();

		const playbook = await c.captureFromPR({
			workspaceId: "ws-1",
			projectId,
			prNumber: 123,
			prUrl: "https://github.com/o/r/pull/123",
			prTitle: "Wire memory capture into the PR flow",
			prBody: null,
			commands: ["bun test packages/host-service"],
			validation: "host-service suite green",
		});

		expect(playbook.status).toBe("provisional");
		expect(playbook.confidence).toBe(0);
		expect(playbook.intent).toBe("Wire memory capture into the PR flow");
		// touchedPaths gathered from the (faked) local diff, sorted + de-duped.
		expect(playbook.touchedPaths).toEqual([
			"apps/web/src/new.ts",
			"packages/host-service/src/app.ts",
		]);
		// Areas derived from the touched paths (multi-label).
		expect(playbook.areaTags).toContain("backend");
		expect(playbook.areaTags).toContain("frontend");
		// diffShape carries the change shape (status tally + churn), never content.
		expect(playbook.diffShape).toContain("2 files");
		expect(playbook.diffShape).toContain("1 added");
		expect(playbook.diffShape).toContain("1 modified");
		expect(playbook.provenance.prNumber).toBe(123);
		expect(playbook.provenance.url).toBe("https://github.com/o/r/pull/123");
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

	it("indexStatus reports an empty index before any build", async () => {
		const c = caller();
		const idx = await c.indexStatus({ projectId });
		expect(idx.indexed).toBe(false);
		expect(idx.entryCount).toBe(0);
		expect(idx.lastIndexedAt).toBeNull();
	});

	it("consolidatePractice → acceptPractice → revertPractice round-trip (B5)", async () => {
		const c = caller();
		// Seed a confirmed playbook to consolidate.
		const p = await c.capture({
			projectId,
			intent: "Prefer object params",
			touchedPaths: ["packages/host-service/src/x.ts"],
			provenance: { prNumber: 9, url: null, taskId: null },
		});
		await c.confirm({ id: p.id });

		// PROPOSE — returns current/proposed/diff, writes nothing.
		const proposal = await c.consolidatePractice({
			scope: "project",
			projectId,
		});
		expect(proposal.scope).toBe("project");
		expect(proposal.sourceCount).toBe(1);
		expect(proposal.proposedDoc).toContain("Prefer object params");
		expect(proposal.currentDoc).toBe("");

		// ACCEPT — version 1.
		const v1 = await c.acceptPractice({
			scope: "project",
			projectId,
			content: proposal.proposedDoc,
			provenance: proposal.provenance,
		});
		expect(v1.version).toBe(1);

		// getPractice now reflects the accepted content.
		const doc = await c.getPractice({ scope: "project", projectId });
		expect(doc.latest?.content).toContain("Prefer object params");

		// Accept an edited v2, then revert → v3 with v1 content.
		await c.acceptPractice({
			scope: "project",
			projectId,
			content: "## edited\n\n- a different rule\n",
		});
		const reverted = await c.revertPractice({ scope: "project", projectId });
		expect(reverted.version).toBe(3);
		expect(reverted.content).toContain("Prefer object params");

		const history = await c.listPracticeVersions({
			scope: "project",
			projectId,
		});
		expect(history.map((v) => v.version)).toEqual([3, 2, 1]);
	});

	it("retrieve assembles a bundle from captured + confirmed playbooks", async () => {
		const c = caller();
		const p = await c.capture({
			projectId,
			intent: "add a backend route",
			touchedPaths: ["packages/host-service/src/foo.ts"],
			commands: ["bun test"],
		});
		await c.confirm({ id: p.id });

		const bundle = await c.retrieve({
			projectId,
			intent: "work on the backend route",
		});
		expect(bundle.queryAreas).toContain("backend");
		expect(bundle.playbooks.some((b) => b.id === p.id)).toBe(true);
		expect(typeof bundle.estimatedTokens).toBe("number");
	});

	it("savedStats computes a percentage from recorded telemetry", async () => {
		const c = caller();
		await c.telemetry.record({
			projectId,
			metric: "tokens",
			baselineValue: 1000,
			observedValue: 600,
		});
		const stats = await c.savedStats({ projectId });
		const tokens = stats.find((s) => s.metric === "tokens");
		expect(tokens?.savedPercent).toBe(40);
	});
});
