import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { memoryPlaybooks, projects } from "../../db/schema";
import { getMemoryVaultDir } from "./paths.ts";
import { MemoryVaultService } from "./vault-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

const PROJECT_ID = "project-1";

function insertPlaybook(
	db: HostDb,
	{
		id,
		intent,
		touchedPaths = ["apps/web/src/x.ts"],
		areaTags = ["frontend"],
		status = "confirmed",
		prNumber = null,
	}: {
		id: string;
		intent: string;
		touchedPaths?: string[];
		areaTags?: string[];
		status?: string;
		prNumber?: number | null;
	},
): void {
	db.insert(memoryPlaybooks)
		.values({
			id,
			projectId: PROJECT_ID,
			intent,
			touchedPathsJson: JSON.stringify(touchedPaths),
			areaTagsJson: JSON.stringify(areaTags),
			status,
			confidence: 80,
			provenanceJson: JSON.stringify({ prNumber, url: null, taskId: null }),
		})
		.run();
}

describe("MemoryVaultService (B6)", () => {
	let db: HostDb;
	let homeDir: string;
	let prevHomeEnv: string | undefined;

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: PROJECT_ID, repoPath: "/tmp/repo" }).run();
		homeDir = mkdtempSync(join(tmpdir(), "b6-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function service() {
		return new MemoryVaultService({ db });
	}

	function vaultPlaybooksDir(): string {
		return join(getMemoryVaultDir(), "playbooks");
	}

	it("writes one note per playbook with wikilinks, under SUPERSET_HOME_DIR", () => {
		insertPlaybook(db, {
			id: "p1",
			intent: "Wire memory capture",
			touchedPaths: ["packages/host-service/src/app.ts"],
			areaTags: ["backend"],
			prNumber: 42,
		});

		const result = service().regenerateVault({ projectId: PROJECT_ID });
		expect(result.written).toBe(1);
		expect(result.pruned).toBe(0);
		// Vault lives under the temp home dir, not the real ~/.superset.
		expect(result.vaultDir.startsWith(homeDir)).toBe(true);

		const files = readdirSync(vaultPlaybooksDir());
		expect(files).toHaveLength(1);
		const note = readFileSync(
			join(vaultPlaybooksDir(), files[0] as string),
			"utf-8",
		);
		expect(note).toContain("# Wire memory capture");
		expect(note).toContain("[[packages/host-service/src/app.ts|app.ts]]");
		expect(note).toContain("[[area-backend]]");
		expect(note).toContain("**PR:** #42");
	});

	it("is idempotent — regenerating yields byte-identical notes", () => {
		insertPlaybook(db, { id: "p1", intent: "Task one" });
		const svc = service();
		svc.regenerateVault({ projectId: PROJECT_ID });
		const files = readdirSync(vaultPlaybooksDir());
		const before = readFileSync(
			join(vaultPlaybooksDir(), files[0] as string),
			"utf-8",
		);

		svc.regenerateVault({ projectId: PROJECT_ID });
		const after = readFileSync(
			join(vaultPlaybooksDir(), files[0] as string),
			"utf-8",
		);
		expect(after).toBe(before);
		expect(readdirSync(vaultPlaybooksDir())).toHaveLength(1);
	});

	it("prunes notes for playbooks that no longer exist", () => {
		insertPlaybook(db, { id: "p1", intent: "Keep me" });
		insertPlaybook(db, { id: "p2", intent: "Forget me" });
		const svc = service();
		svc.regenerateVault({ projectId: PROJECT_ID });
		expect(readdirSync(vaultPlaybooksDir())).toHaveLength(2);

		// Forget p2, regenerate → its note is pruned.
		db.delete(memoryPlaybooks).where(eq(memoryPlaybooks.id, "p2")).run();
		const result = svc.regenerateVault({ projectId: PROJECT_ID });
		expect(result.pruned).toBe(1);
		expect(readdirSync(vaultPlaybooksDir())).toHaveLength(1);
	});

	it("links similar playbooks in the note", () => {
		insertPlaybook(db, {
			id: "p1",
			intent: "Task A",
			touchedPaths: ["shared.ts"],
			areaTags: ["backend"],
		});
		insertPlaybook(db, {
			id: "p2",
			intent: "Task B",
			touchedPaths: ["shared.ts"],
			areaTags: ["backend"],
		});
		service().regenerateVault({ projectId: PROJECT_ID });
		const files = readdirSync(vaultPlaybooksDir());
		const noteA = readFileSync(
			join(
				vaultPlaybooksDir(),
				files.find((f) => f.startsWith("task-a")) as string,
			),
			"utf-8",
		);
		expect(noteA).toContain("## Similar playbooks");
		expect(noteA).toContain("Task B");
	});

	it("graph() returns nodes + edges without writing files", () => {
		insertPlaybook(db, {
			id: "p1",
			intent: "G1",
			touchedPaths: ["a.ts"],
			areaTags: ["frontend"],
		});
		const graph = service().graph({ projectId: PROJECT_ID });
		expect(graph.nodes.some((n) => n.kind === "playbook")).toBe(true);
		expect(graph.nodes.some((n) => n.kind === "file")).toBe(true);
		expect(graph.nodes.some((n) => n.kind === "area")).toBe(true);
		// graph() does not generate the vault.
		expect(existsSync(vaultPlaybooksDir())).toBe(false);
	});
});
