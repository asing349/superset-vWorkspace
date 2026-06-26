import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import {
	memoryFingerprints,
	memoryPracticeVersions,
	memoryProjectIndex,
	projects,
	prReviewReviewerConfig,
} from "../../../db/schema";
import { ProjectIndexService } from "../../../runtime/memory";
import { markReviewerContextStale } from "../../../runtime/pr-review/index";
import type { HostServiceContext } from "../../../types";
import { reviewerRouter } from "./reviewer.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

/** Fresh in-memory db with ALL migrations — proves 0013 applies cleanly too. */
function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** Minimal `readPracticeVersion` over the real practice table (fake retrieve). */
function readLatestPractice(
	db: HostDb,
	scope: "project" | "global",
	projectId: string | null,
) {
	const where =
		scope === "global"
			? eq(memoryPracticeVersions.scope, "global")
			: and(
					eq(memoryPracticeVersions.scope, "project"),
					projectId === null
						? eq(memoryPracticeVersions.scope, "project")
						: eq(memoryPracticeVersions.projectId, projectId),
				);
	const row = db
		.select()
		.from(memoryPracticeVersions)
		.where(where)
		.orderBy(desc(memoryPracticeVersions.version))
		.get();
	return row
		? {
				id: row.id,
				scope: row.scope as "project" | "global",
				projectId: row.projectId,
				version: row.version,
				content: row.content,
				provenance: row.provenance,
				createdAt: row.createdAt,
			}
		: null;
}

function buildCtx(db: HostDb): HostServiceContext {
	const memoryIndex = new ProjectIndexService({ db });
	const runtime = {
		memoryIndex,
		memoryRetrieve: {
			readPracticeVersion: ({
				scope,
				projectId,
			}: {
				scope: "project" | "global";
				projectId: string | null;
			}) => readLatestPractice(db, scope, projectId),
			// Never invoked by setup/refresh; provided so buildGroundingServices can
			// wrap it.
			retrieve: () =>
				Promise.resolve({
					practiceProject: null,
					practiceGlobal: null,
					playbooks: [],
					indexSlices: [],
				}),
		},
	};
	return {
		db,
		isAuthenticated: true,
		runtime,
	} as unknown as HostServiceContext;
}

function addPracticeVersion(
	db: HostDb,
	options: {
		scope: "project" | "global";
		projectId: string | null;
		version: number;
		content: string;
	},
): void {
	db.insert(memoryPracticeVersions)
		.values({
			id: randomUUID(),
			scope: options.scope,
			projectId: options.projectId,
			version: options.version,
			content: options.content,
		})
		.run();
}

function seedIndexEntry(
	db: HostDb,
	options: { projectId: string; path: string; commitSha: string },
): void {
	const fpId = randomUUID();
	db.insert(memoryFingerprints)
		.values({
			id: fpId,
			projectId: options.projectId,
			subject: options.path,
			contentHash: `h-${options.path}`,
			commitSha: options.commitSha,
		})
		.run();
	db.insert(memoryProjectIndex)
		.values({
			id: randomUUID(),
			projectId: options.projectId,
			path: options.path,
			kind: "file",
			areaTagsJson: "[]",
			summary: null,
			fingerprintId: fpId,
		})
		.run();
}

describe("reviewerRouter (M5)", () => {
	let db: HostDb;
	const projectId = "project-rev-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		return reviewerRouter.createCaller(buildCtx(db));
	}

	function countRows(): number {
		return db.select().from(prReviewReviewerConfig).all().length;
	}

	it("getConfig is null and shouldShowSetupCard is true before setup", async () => {
		const c = caller();
		expect(await c.getConfig({ projectId })).toBeNull();
		expect(await c.shouldShowSetupCard({ projectId })).toBe(true);
	});

	it("setup snapshots the current context, enables, and gates the card off", async () => {
		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 1,
			content: "do x",
		});
		seedIndexEntry(db, { projectId, path: "a.ts", commitSha: "sha-1" });

		const c = caller();
		const config = await c.setup({ projectId, configuredBy: "ajit" });
		expect(config.enabled).toBe(true);
		expect(config.practiceProjectVersion).toBe(1);
		expect(config.indexCommitSha).toBe("sha-1");
		expect(config.indexEntryCount).toBe(1);
		expect(config.groundingLayers).toContain("practice-project");
		expect(config.stale).toBe(false);

		expect(await c.shouldShowSetupCard({ projectId })).toBe(false);
		expect(countRows()).toBe(1);
	});

	it("setup is an upsert keyed (projectId) — re-running replaces, not duplicates", async () => {
		const c = caller();
		await c.setup({ projectId });
		await c.setup({ projectId });
		expect(countRows()).toBe(1);
	});

	it("refreshContext throws when the reviewer is not set up", async () => {
		const c = caller();
		await expect(c.refreshContext({ projectId })).rejects.toThrow(
			/not set up/i,
		);
	});

	it("refreshContext reports NOT changed when the context is identical", async () => {
		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 1,
			content: "do x",
		});
		const c = caller();
		await c.setup({ projectId });
		const result = await c.refreshContext({ projectId });
		expect(result.diff.changed).toBe(false);
		expect(result.diff.changes).toHaveLength(0);
	});

	it("refreshContext detects a new practice version and re-baselines", async () => {
		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 1,
			content: "do x",
		});
		const c = caller();
		await c.setup({ projectId });

		// A new consolidated practice version lands.
		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 2,
			content: "do x and y",
		});

		const result = await c.refreshContext({ projectId });
		expect(result.diff.changed).toBe(true);
		expect(result.diff.changes.map((c) => c.kind)).toContain(
			"practice-project",
		);
		expect(result.config.practiceProjectVersion).toBe(2);

		// Re-baselined: a second refresh now sees no change.
		const second = await c.refreshContext({ projectId });
		expect(second.diff.changed).toBe(false);
	});

	it("refreshContext detects an index change (new commit sha)", async () => {
		seedIndexEntry(db, { projectId, path: "a.ts", commitSha: "sha-1" });
		const c = caller();
		await c.setup({ projectId });

		// The index moves to a new commit.
		db.delete(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, projectId))
			.run();
		db.delete(memoryFingerprints)
			.where(eq(memoryFingerprints.projectId, projectId))
			.run();
		seedIndexEntry(db, { projectId, path: "a.ts", commitSha: "sha-2" });

		const result = await c.refreshContext({ projectId });
		expect(result.diff.changed).toBe(true);
		expect(result.diff.changes.map((c) => c.kind)).toContain("project-index");
	});

	it("getContextStatus surfaces a live diff WITHOUT refreshing (no re-baseline)", async () => {
		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 1,
			content: "do x",
		});
		const c = caller();
		await c.setup({ projectId });

		addPracticeVersion(db, {
			scope: "project",
			projectId,
			version: 2,
			content: "do x and y",
		});

		const status = await c.getContextStatus({ projectId });
		expect(status.configured).toBe(true);
		expect(status.diff.changed).toBe(true);

		// Reading the status must NOT re-baseline — a follow-up read still shows it.
		const again = await c.getContextStatus({ projectId });
		expect(again.diff.changed).toBe(true);
	});

	it("markReviewerContextStale flips the flag only (idempotent, never refreshes)", async () => {
		const c = caller();
		await c.setup({ projectId });
		expect((await c.getConfig({ projectId }))?.stale).toBe(false);

		markReviewerContextStale({ db, projectId });
		expect((await c.getConfig({ projectId }))?.stale).toBe(true);
		expect((await c.getContextStatus({ projectId })).stale).toBe(true);

		// Idempotent: a second flip is a no-op.
		markReviewerContextStale({ db, projectId });
		expect((await c.getConfig({ projectId }))?.stale).toBe(true);

		// An explicit refresh clears the flag (re-baseline).
		await c.refreshContext({ projectId });
		expect((await c.getConfig({ projectId }))?.stale).toBe(false);
	});

	it("markReviewerContextStale on an unconfigured project is a harmless no-op", () => {
		expect(() =>
			markReviewerContextStale({ db, projectId: "ghost" }),
		).not.toThrow();
		expect(countRows()).toBe(0);
	});

	it("listContextStatus enumerates every project", async () => {
		db.insert(projects)
			.values({ id: "project-rev-2", repoPath: "/tmp/r2" })
			.run();
		const c = caller();
		await c.setup({ projectId });

		const statuses = await c.listContextStatus();
		expect(statuses).toHaveLength(2);
		const configured = statuses.find((s) => s.projectId === projectId);
		const unconfigured = statuses.find((s) => s.projectId === "project-rev-2");
		expect(configured?.configured).toBe(true);
		expect(unconfigured?.configured).toBe(false);
		expect(unconfigured?.config).toBeNull();
	});
});
