import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { memoryPlaybooks, projects } from "../../db/schema";
import { MemoryConsolidationService } from "./consolidation-service.ts";
import { MEMORY_SKILL_RELATIVE_PATH } from "./push-generator.ts";
import {
	regenerateMemorySkillForProject,
	regenerateMemorySkillsForAllProjects,
} from "./skill-regen.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/**
 * Wave-4 A1(b): the generated `superset-memory` skill is regenerated into each
 * project's repo root on memory mutations + startup. These tests use temp repo
 * dirs as `projects.repoPath`, so the real repo is never written.
 */
describe("memory skill regen (wave-4 A1b)", () => {
	let db: HostDb;
	let repoA: string;
	let repoB: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;

	beforeEach(() => {
		db = buildDb();
		repoA = mkdtempSync(join(tmpdir(), "skill-regen-repoA-"));
		repoB = mkdtempSync(join(tmpdir(), "skill-regen-repoB-"));
		homeDir = mkdtempSync(join(tmpdir(), "skill-regen-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
		db.insert(projects).values({ id: "projA", repoPath: repoA }).run();
		db.insert(projects).values({ id: "projB", repoPath: repoB }).run();
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		for (const dir of [repoA, repoB, homeDir]) {
			rmSync(dir, { recursive: true, force: true });
		}
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("writes the skill into a project's repoPath", () => {
		const result = regenerateMemorySkillForProject({ db, projectId: "projA" });
		expect(result).not.toBeNull();
		const expected = join(repoA, MEMORY_SKILL_RELATIVE_PATH);
		expect(result?.path).toBe(expected);
		expect(existsSync(expected)).toBe(true);
		expect(readFileSync(expected, "utf8")).toContain("name: superset-memory");
	});

	it("returns null for an unknown project and never throws", () => {
		expect(
			regenerateMemorySkillForProject({ db, projectId: "nope" }),
		).toBeNull();
	});

	it("regenerates for every known project on startup", () => {
		const written = regenerateMemorySkillsForAllProjects({ db });
		expect(written.length).toBe(2);
		expect(existsSync(join(repoA, MEMORY_SKILL_RELATIVE_PATH))).toBe(true);
		expect(existsSync(join(repoB, MEMORY_SKILL_RELATIVE_PATH))).toBe(true);
	});

	it("fires the consolidation post-write hook on a project-scoped accept", () => {
		const regenerated: string[] = [];
		const consolidation = new MemoryConsolidationService({
			db,
			onProjectPracticeWritten: ({ projectId }) => {
				const r = regenerateMemorySkillForProject({ db, projectId });
				if (r) regenerated.push(projectId);
			},
		});

		// Seed a confirmed playbook so propose/accept has content (logic unchanged).
		db.insert(memoryPlaybooks)
			.values({
				id: "pb-skill-1",
				projectId: "projA",
				intent: "do backend work",
				touchedPathsJson: JSON.stringify(["packages/host-service/src/x.ts"]),
				areaTagsJson: JSON.stringify(["backend"]),
				commandsJson: JSON.stringify(["bun test"]),
				gotcha: null,
				diffShape: null,
				validation: "green",
				status: "confirmed",
				confidence: 80,
				provenanceJson: JSON.stringify({
					prNumber: null,
					url: null,
					taskId: null,
				}),
			})
			.run();

		const proposal = consolidation.propose({
			scope: "project",
			projectId: "projA",
		});
		consolidation.accept({
			scope: "project",
			projectId: "projA",
			content: proposal.proposedDoc,
		});

		expect(regenerated).toEqual(["projA"]);
		expect(existsSync(join(repoA, MEMORY_SKILL_RELATIVE_PATH))).toBe(true);
	});

	it("does NOT fire the hook on a global-scoped accept", () => {
		let fired = false;
		const consolidation = new MemoryConsolidationService({
			db,
			onProjectPracticeWritten: () => {
				fired = true;
			},
		});
		consolidation.accept({
			scope: "global",
			projectId: null,
			content: "# global practice\n",
		});
		expect(fired).toBe(false);
	});
});
