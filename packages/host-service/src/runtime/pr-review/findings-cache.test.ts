import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects, prReviewFindings } from "../../db/schema";
import {
	getCurrentFindings,
	markFindingsStaleOnHeadChange,
	putFindings,
} from "./findings-cache";
import type { Finding, FindingsReport } from "./findings-types";

/**
 * Wave-6 M1 findings-cache contract test. Mirrors the wave-5 guide-cache test:
 *  - putFindings / getCurrentFindings round-trip (JSON in → typed report out,
 *    plus the head SHA + stale flag).
 *  - markFindingsStaleOnHeadChange flips ONLY findings at a different head SHA,
 *    runs NOTHING else (no re-review — the button-only guardrail), and leaves the
 *    same-SHA report untouched.
 */

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "f-1",
		severity: "warning",
		category: "correctness",
		anchor: { file: "src/a.ts", line: 3 },
		text: "src/a.ts:3",
		rationale: "Off-by-one.",
		state: "open",
		source: "local-ai",
		...overrides,
	};
}

function makeReport(overrides: Partial<FindingsReport> = {}): FindingsReport {
	return {
		findings: [makeFinding()],
		prNumber: 5,
		headSha: "sha-aaa",
		enriched: true,
		baselineOnly: false,
		...overrides,
	};
}

describe("findings-cache: putFindings / getCurrentFindings", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("round-trips a report and reports headSha + stale=false on a fresh write", () => {
		const report = makeReport({ headSha: "sha-aaa" });
		putFindings({ db, projectId, prNumber: 5, headSha: "sha-aaa", report });

		const current = getCurrentFindings({ db, projectId, prNumber: 5 });
		expect(current).not.toBeNull();
		expect(current?.headSha).toBe("sha-aaa");
		expect(current?.stale).toBe(false);
		expect(current?.report).toEqual(report);
	});

	it("returns null when no review has been run for the PR", () => {
		expect(getCurrentFindings({ db, projectId, prNumber: 99 })).toBeNull();
	});

	it("upserts the same (projectId, prNumber, headSha) in place (no duplicate row)", () => {
		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			report: makeReport({ enriched: false }),
		});
		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			report: makeReport({ enriched: true }),
		});
		const rows = db.select().from(prReviewFindings).all();
		expect(rows.length).toBe(1);
		expect(
			getCurrentFindings({ db, projectId, prNumber: 5 })?.report.enriched,
		).toBe(true);
	});

	it("a fresh write resets a previously-staled report back to current", () => {
		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			report: makeReport({ headSha: "sha-aaa" }),
		});
		markFindingsStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "sha-bbb",
		});
		expect(getCurrentFindings({ db, projectId, prNumber: 5 })?.stale).toBe(
			true,
		);

		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "sha-aaa",
			report: makeReport({ headSha: "sha-aaa" }),
		});
		expect(getCurrentFindings({ db, projectId, prNumber: 5 })?.stale).toBe(
			false,
		);
	});
});

describe("findings-cache: markFindingsStaleOnHeadChange", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("marks a report built against an OLD head SHA stale, re-reviewing nothing", () => {
		const report = makeReport({ headSha: "old-sha" });
		putFindings({ db, projectId, prNumber: 5, headSha: "old-sha", report });

		markFindingsStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-sha",
		});

		const after = db.select().from(prReviewFindings).all();
		// NOTHING re-reviewed — still exactly one row; the SAME payload; only the
		// stale flag flipped.
		expect(after.length).toBe(1);
		expect(after[0]?.stale).toBe(true);
		expect(after[0]?.findingsJson).toBe(JSON.stringify(report));
		const current = getCurrentFindings({ db, projectId, prNumber: 5 });
		expect(current?.stale).toBe(true);
		expect(current?.report).toEqual(report);
	});

	it("leaves a report already at the new head SHA untouched (not stale)", () => {
		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "new-sha",
			report: makeReport({ headSha: "new-sha" }),
		});
		markFindingsStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-sha",
		});
		expect(getCurrentFindings({ db, projectId, prNumber: 5 })?.stale).toBe(
			false,
		);
	});

	it("does not touch findings for OTHER PRs", () => {
		putFindings({
			db,
			projectId,
			prNumber: 5,
			headSha: "old-5",
			report: makeReport({ prNumber: 5, headSha: "old-5" }),
		});
		putFindings({
			db,
			projectId,
			prNumber: 6,
			headSha: "old-6",
			report: makeReport({ prNumber: 6, headSha: "old-6" }),
		});
		markFindingsStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-5",
		});
		expect(getCurrentFindings({ db, projectId, prNumber: 5 })?.stale).toBe(
			true,
		);
		expect(getCurrentFindings({ db, projectId, prNumber: 6 })?.stale).toBe(
			false,
		);
	});
});
