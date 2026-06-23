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
import { memoryFingerprints, projects, workspaces } from "../../db/schema";
import type {
	GitChangedEvent,
	GitChangedListener,
	GitWatcher,
} from "../../events/git-watcher.ts";
import { IndexRefreshWatcher } from "./index-refresh-watcher.ts";
import { ProjectIndexService } from "./index-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** Minimal GitWatcher stub: lets a test fire a synthetic `onChanged` event. */
class FakeGitWatcher {
	private listener: GitChangedListener | null = null;
	onChanged(listener: GitChangedListener): () => void {
		this.listener = listener;
		return () => {
			this.listener = null;
		};
	}
	emit(event: GitChangedEvent): void {
		this.listener?.(event);
	}
	get hasListener(): boolean {
		return this.listener !== null;
	}
}

describe("IndexRefreshWatcher (B3 fs:events hook)", () => {
	let db: HostDb;
	let repoPath: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "proj-refresh-1";
	const workspaceId = "ws-refresh-1";

	beforeEach(() => {
		db = buildDb();
		repoPath = mkdtempSync(join(tmpdir(), "memory-refresh-repo-"));
		db.insert(projects).values({ id: projectId, repoPath }).run();
		db.insert(workspaces)
			.values({
				id: workspaceId,
				projectId,
				worktreePath: repoPath,
				branch: "main",
			})
			.run();
		homeDir = mkdtempSync(join(tmpdir(), "memory-refresh-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;

		mkdirSync(join(repoPath, "apps/web/src"), { recursive: true });
		writeFileSync(
			join(repoPath, "apps/web/src/page.tsx"),
			"export const a = 1;\n",
		);
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(repoPath, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("refreshes the affected index entry when GitWatcher reports changed paths", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);
		const before = db
			.select()
			.from(memoryFingerprints)
			.where(eq(memoryFingerprints.subject, "apps/web/src/page.tsx"))
			.get();

		const fakeWatcher = new FakeGitWatcher();
		const watcher = new IndexRefreshWatcher({
			db,
			indexService: service,
			gitWatcher: fakeWatcher as unknown as GitWatcher,
		});
		watcher.start();
		expect(fakeWatcher.hasListener).toBe(true);

		// Change the file, then fire a targeted change event.
		writeFileSync(
			join(repoPath, "apps/web/src/page.tsx"),
			"export const a = 1;\nexport const b = 2;\n",
		);
		fakeWatcher.emit({ workspaceId, paths: ["apps/web/src/page.tsx"] });
		// The handler is async; let microtasks drain.
		await new Promise((r) => setTimeout(r, 10));

		const after = db
			.select()
			.from(memoryFingerprints)
			.where(eq(memoryFingerprints.subject, "apps/web/src/page.tsx"))
			.get();
		expect(after?.contentHash).not.toBe(before?.contentHash);

		watcher.stop();
		expect(fakeWatcher.hasListener).toBe(false);
	});

	it("ignores broad changes (no paths) — no targeted refresh", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);

		const fakeWatcher = new FakeGitWatcher();
		const watcher = new IndexRefreshWatcher({
			db,
			indexService: service,
			gitWatcher: fakeWatcher as unknown as GitWatcher,
		});
		watcher.start();

		// A broad event (branch switch / commit) carries no paths — must not throw.
		expect(() => fakeWatcher.emit({ workspaceId })).not.toThrow();
		await new Promise((r) => setTimeout(r, 10));
		watcher.stop();
	});

	it("no-ops for an unknown workspace", async () => {
		const service = new ProjectIndexService({ db });
		await service.buildProjectIndex(projectId);
		const fakeWatcher = new FakeGitWatcher();
		const watcher = new IndexRefreshWatcher({
			db,
			indexService: service,
			gitWatcher: fakeWatcher as unknown as GitWatcher,
		});
		watcher.start();
		expect(() =>
			fakeWatcher.emit({ workspaceId: "ghost", paths: ["x.ts"] }),
		).not.toThrow();
		await new Promise((r) => setTimeout(r, 10));
		watcher.stop();
	});
});
