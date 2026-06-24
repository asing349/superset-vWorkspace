import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects, prReviewGuides } from "../../db/schema";
import {
	getCurrentGuide,
	getDiff,
	markGuideStaleOnHeadChange,
	type PrDiffResultLike,
	putDiff,
	putGuide,
} from "./guide-cache";
import type { PrReviewGuide } from "./guide-types";

/**
 * M6 guide/diff cache contract test. Covers the shared API M4 calls:
 *  - putGuide / getCurrentGuide round-trip (JSON in → typed guide out, plus the
 *    head SHA + stale flag).
 *  - markGuideStaleOnHeadChange flips ONLY guides at a different head SHA, runs
 *    NOTHING else (no regeneration — the never-auto-generate guardrail), and
 *    leaves the same-SHA guide untouched.
 *  - putDiff / getDiff round-trip keyed (projectId, prNumber, headSha).
 */

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function makeGuide(overrides: Partial<PrReviewGuide> = {}): PrReviewGuide {
	return {
		sections: [
			{
				id: "at-a-glance",
				title: "At a glance",
				items: [{ text: "1 file changed", anchor: { file: "src/a.ts" } }],
			},
		],
		prNumber: 5,
		headSha: "sha-aaa",
		areaTags: [],
		grounded: false,
		...overrides,
	};
}

describe("guide-cache: putGuide / getCurrentGuide", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("round-trips a guide and reports headSha + stale=false on a fresh write", () => {
		const guide = makeGuide({ headSha: "sha-aaa", grounded: true });
		putGuide({ db, projectId, prNumber: 5, headSha: "sha-aaa", guide });

		const current = getCurrentGuide({ db, projectId, prNumber: 5 });
		expect(current).not.toBeNull();
		expect(current?.headSha).toBe("sha-aaa");
		expect(current?.stale).toBe(false);
		expect(current?.guide).toEqual(guide);
	});

	it("returns null when no guide is cached for the PR", () => {
		expect(getCurrentGuide({ db, projectId, prNumber: 99 })).toBeNull();
	});

	it("upserts the same (projectId, prNumber, headSha) in place (no duplicate row)", () => {
		const a = makeGuide({ headSha: "sha-aaa", grounded: false });
		const b = makeGuide({ headSha: "sha-aaa", grounded: true });
		putGuide({ db, projectId, prNumber: 5, headSha: "sha-aaa", guide: a });
		putGuide({ db, projectId, prNumber: 5, headSha: "sha-aaa", guide: b });

		const rows = db
			.select()
			.from(prReviewGuides)
			.where(eqProjectPr(projectId, 5))
			.all();
		expect(rows.length).toBe(1);
		expect(
			getCurrentGuide({ db, projectId, prNumber: 5 })?.guide.grounded,
		).toBe(true);
	});

	it("a fresh write resets a previously-staled guide back to current", () => {
		putGuide({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			guide: makeGuide({ headSha: "sha-aaa" }),
		});
		// Mark it stale (as if a new commit arrived)...
		markGuideStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "sha-bbb",
		});
		expect(getCurrentGuide({ db, projectId, prNumber: 5 })?.stale).toBe(true);

		// ...then regenerate against the same old SHA → fresh, not stale.
		putGuide({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			guide: makeGuide({ headSha: "sha-aaa" }),
		});
		expect(getCurrentGuide({ db, projectId, prNumber: 5 })?.stale).toBe(false);
	});
});

describe("guide-cache: markGuideStaleOnHeadChange", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("marks a guide built against an OLD head SHA stale, regenerating nothing", () => {
		const guide = makeGuide({ headSha: "old-sha" });
		putGuide({ db, projectId, prNumber: 5, headSha: "old-sha", guide });

		const before = db.select().from(prReviewGuides).all();
		expect(before.length).toBe(1);

		markGuideStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-sha",
		});

		const after = db.select().from(prReviewGuides).all();
		// NOTHING generated — still exactly one row; the SAME guide payload; only
		// the stale flag flipped. No new guide row, no diff row.
		expect(after.length).toBe(1);
		expect(after[0]?.stale).toBe(true);
		expect(after[0]?.guideJson).toBe(JSON.stringify(guide));
		const current = getCurrentGuide({ db, projectId, prNumber: 5 });
		expect(current?.stale).toBe(true);
		expect(current?.guide).toEqual(guide);
	});

	it("leaves a guide already at the new head SHA untouched (not stale)", () => {
		putGuide({
			db,
			projectId,
			prNumber: 5,
			headSha: "new-sha",
			guide: makeGuide({ headSha: "new-sha" }),
		});

		markGuideStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-sha",
		});

		expect(getCurrentGuide({ db, projectId, prNumber: 5 })?.stale).toBe(false);
	});

	it("does not touch guides for OTHER PRs", () => {
		putGuide({
			db,
			projectId,
			prNumber: 5,
			headSha: "old-5",
			guide: makeGuide({ prNumber: 5, headSha: "old-5" }),
		});
		putGuide({
			db,
			projectId,
			prNumber: 6,
			headSha: "old-6",
			guide: makeGuide({ prNumber: 6, headSha: "old-6" }),
		});

		markGuideStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-5",
		});

		expect(getCurrentGuide({ db, projectId, prNumber: 5 })?.stale).toBe(true);
		expect(getCurrentGuide({ db, projectId, prNumber: 6 })?.stale).toBe(false);
	});
});

describe("guide-cache: putDiff / getDiff", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	const diff: PrDiffResultLike = {
		files: [
			{
				filename: "src/a.ts",
				status: "modified",
				patch: "@@ -1 +1 @@\n-a\n+b",
				additions: 1,
				deletions: 1,
				previousFilename: undefined,
			},
		],
		body: "PR body",
		baseBranch: "main",
		headSha: "sha-aaa",
		prNumber: 5,
	};

	it("round-trips the diff keyed (projectId, prNumber, headSha)", () => {
		putDiff({ db, projectId, prNumber: 5, headSha: "sha-aaa", diff });
		const got = getDiff({ db, projectId, prNumber: 5, headSha: "sha-aaa" });
		expect(got).toEqual(diff);
	});

	it("returns null for a different head SHA (a new commit is a new key)", () => {
		putDiff({ db, projectId, prNumber: 5, headSha: "sha-aaa", diff });
		expect(
			getDiff({ db, projectId, prNumber: 5, headSha: "sha-bbb" }),
		).toBeNull();
	});
});

// Keeps the duplicate-row assertion readable.
function eqProjectPr(projectId: string, prNumber: number) {
	return and(
		eq(prReviewGuides.projectId, projectId),
		eq(prReviewGuides.prNumber, prNumber),
	);
}
