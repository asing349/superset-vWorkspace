import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { memoryPlaybooks, projects } from "../../db/schema";
import { MemoryConsolidationService } from "./consolidation-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

const PROJECT_ID = "project-1";

function insertConfirmed(
	db: HostDb,
	{
		id,
		intent,
		projectId = PROJECT_ID,
		areaTags = ["backend"],
		confidence = 80,
		prNumber = null,
		status = "confirmed",
	}: {
		id: string;
		intent: string;
		projectId?: string | null;
		areaTags?: string[];
		confidence?: number;
		prNumber?: number | null;
		status?: string;
	},
): void {
	db.insert(memoryPlaybooks)
		.values({
			id,
			projectId,
			intent,
			areaTagsJson: JSON.stringify(areaTags),
			status,
			confidence,
			provenanceJson: JSON.stringify({ prNumber, url: null, taskId: null }),
		})
		.run();
}

describe("MemoryConsolidationService (B5)", () => {
	let db: HostDb;
	let repoDir: string; // TEMP repo (project AGENTS.md target)
	let homeDir: string; // TEMP ~/.superset (global target)
	let prevHomeEnv: string | undefined;

	beforeEach(() => {
		db = buildDb();
		repoDir = mkdtempSync(join(tmpdir(), "b5-repo-"));
		db.insert(projects).values({ id: PROJECT_ID, repoPath: repoDir }).run();

		homeDir = mkdtempSync(join(tmpdir(), "b5-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(repoDir, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function service() {
		return new MemoryConsolidationService({ db });
	}

	it("targets the project's AGENTS.md and the global practice.md (temp paths)", () => {
		const svc = service();
		expect(
			svc.resolveTargetPath({ scope: "project", projectId: PROJECT_ID }),
		).toBe(join(repoDir, "AGENTS.md"));
		expect(svc.resolveTargetPath({ scope: "global", projectId: null })).toBe(
			join(homeDir, "practice.md"),
		);
	});

	it("proposes from confirmed playbooks without writing anything", () => {
		insertConfirmed(db, {
			id: "p1",
			intent: "Use object params",
			prNumber: 12,
		});
		insertConfirmed(db, {
			id: "p2",
			intent: "Skip me",
			status: "provisional",
		});

		const proposal = service().propose({
			scope: "project",
			projectId: PROJECT_ID,
		});
		expect(proposal.sourceCount).toBe(1);
		expect(proposal.proposedDoc).toContain("Use object params (#12)");
		expect(proposal.currentDoc).toBe("");
		expect(proposal.diff.added).toBeGreaterThan(0);
		// PROPOSE must not write the target file.
		expect(() => readFileSync(join(repoDir, "AGENTS.md"), "utf-8")).toThrow();
	});

	it("accept writes a managed block to AGENTS.md without clobbering hand-written content, and versions it", () => {
		const agentsPath = join(repoDir, "AGENTS.md");
		writeFileSync(agentsPath, "# AGENTS\n\nHand-written rules.\n");

		const svc = service();
		const proposal = (() => {
			insertConfirmed(db, { id: "p1", intent: "Prefer Bun", prNumber: 7 });
			return svc.propose({ scope: "project", projectId: PROJECT_ID });
		})();

		const version = svc.accept({
			scope: "project",
			projectId: PROJECT_ID,
			content: proposal.proposedDoc,
			provenance: proposal.provenance,
		});
		expect(version.version).toBe(1);

		const written = readFileSync(agentsPath, "utf-8");
		expect(written).toContain("Hand-written rules.");
		expect(written).toContain("<!-- superset-memory:start -->");
		expect(written).toContain("Prefer Bun");

		// A second propose now sees the managed block as currentDoc.
		const next = svc.propose({ scope: "project", projectId: PROJECT_ID });
		expect(next.currentDoc).toContain("Prefer Bun");
	});

	it("accept persists user edits verbatim", () => {
		const svc = service();
		const edited = "## Coding practice\n\n- Hand-edited rule by the user\n";
		svc.accept({
			scope: "project",
			projectId: PROJECT_ID,
			content: edited,
			provenance: "edited",
		});
		const written = readFileSync(join(repoDir, "AGENTS.md"), "utf-8");
		expect(written).toContain("Hand-edited rule by the user");
	});

	it("revert restores the prior version's content and records a new version", () => {
		const svc = service();
		svc.accept({
			scope: "project",
			projectId: PROJECT_ID,
			content: "version one body",
			provenance: "v1",
		});
		svc.accept({
			scope: "project",
			projectId: PROJECT_ID,
			content: "version two body",
			provenance: "v2",
		});

		const reverted = svc.revert({ scope: "project", projectId: PROJECT_ID });
		// Revert is recorded as a NEW (3rd) version, content = v1.
		expect(reverted.version).toBe(3);
		expect(reverted.content).toBe("version one body");

		const written = readFileSync(join(repoDir, "AGENTS.md"), "utf-8");
		expect(written).toContain("version one body");

		const history = svc.listVersions({
			scope: "project",
			projectId: PROJECT_ID,
		});
		expect(history.map((v) => v.version)).toEqual([3, 2, 1]);
	});

	it("revert to a specific version", () => {
		const svc = service();
		svc.accept({ scope: "project", projectId: PROJECT_ID, content: "A" });
		svc.accept({ scope: "project", projectId: PROJECT_ID, content: "B" });
		svc.accept({ scope: "project", projectId: PROJECT_ID, content: "C" });

		const reverted = svc.revert({
			scope: "project",
			projectId: PROJECT_ID,
			toVersion: 1,
		});
		expect(reverted.content).toBe("A");
		expect(reverted.version).toBe(4);
	});

	it("revert throws when there is no prior version", () => {
		const svc = service();
		expect(() =>
			svc.revert({ scope: "project", projectId: PROJECT_ID }),
		).toThrow();
		svc.accept({
			scope: "project",
			projectId: PROJECT_ID,
			content: "only one",
		});
		expect(() =>
			svc.revert({ scope: "project", projectId: PROJECT_ID }),
		).toThrow();
	});

	it("global scope writes the whole practice.md under the temp home dir", () => {
		const svc = service();
		// Cross-repo confirmed playbooks (2 distinct projects) → promoted globally.
		db.insert(projects).values({ id: "project-2", repoPath: "/tmp/p2" }).run();
		insertConfirmed(db, {
			id: "g1",
			intent: "Object params",
			projectId: PROJECT_ID,
		});
		insertConfirmed(db, {
			id: "g2",
			intent: "object params",
			projectId: "project-2",
		});

		const proposal = svc.propose({ scope: "global", projectId: null });
		expect(proposal.proposedDoc).toContain("Object params");

		svc.accept({
			scope: "global",
			projectId: null,
			content: proposal.proposedDoc,
		});
		const written = readFileSync(join(homeDir, "practice.md"), "utf-8");
		expect(written).toContain("Object params");
	});
});
