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
	markFindingPosted,
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

describe("findings-cache: markFindingPosted", () => {
	let db: HostDb;
	const projectId = "proj-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/p" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("flips ONLY the named finding to posted and re-persists the blob", () => {
		const report = makeReport({
			findings: [
				makeFinding({ id: "f-1" }),
				makeFinding({ id: "f-2", anchor: { file: "src/b.ts", line: 9 } }),
			],
		});
		putFindings({ db, projectId, prNumber: 5, headSha: "sha-aaa", report });

		const result = markFindingPosted({
			db,
			projectId,
			prNumber: 5,
			findingId: "f-2",
		});

		expect(result?.report.findings.find((f) => f.id === "f-2")?.state).toBe(
			"posted",
		);
		// The other finding is untouched.
		expect(result?.report.findings.find((f) => f.id === "f-1")?.state).toBe(
			"open",
		);
		// The persisted blob reflects the flip (single source of truth).
		expect(
			getCurrentFindings({ db, projectId, prNumber: 5 })?.report.findings.find(
				(f) => f.id === "f-2",
			)?.state,
		).toBe("posted");
	});

	it("PRESERVES the stale flag — posting a comment must not un-stale a report", () => {
		const report = makeReport({ headSha: "old-sha" });
		putFindings({ db, projectId, prNumber: 5, headSha: "old-sha", report });
		markFindingsStaleOnHeadChange({
			db,
			projectId,
			prNumber: 5,
			newHeadSha: "new-sha",
		});
		expect(getCurrentFindings({ db, projectId, prNumber: 5 })?.stale).toBe(
			true,
		);

		const result = markFindingPosted({
			db,
			projectId,
			prNumber: 5,
			findingId: "f-1",
		});

		// Finding flipped, but the report stays stale + at its original head SHA.
		expect(result?.report.findings[0]?.state).toBe("posted");
		expect(result?.stale).toBe(true);
		expect(result?.headSha).toBe("old-sha");
		const current = getCurrentFindings({ db, projectId, prNumber: 5 });
		expect(current?.stale).toBe(true);
		expect(current?.headSha).toBe("old-sha");
	});

	it("is idempotent for an already-posted finding (no further change)", () => {
		const report = makeReport({
			findings: [makeFinding({ id: "f-1", state: "posted" })],
		});
		putFindings({ db, projectId, prNumber: 5, headSha: "sha-aaa", report });
		const before = db.select().from(prReviewFindings).get();

		const result = markFindingPosted({
			db,
			projectId,
			prNumber: 5,
			findingId: "f-1",
		});

		expect(result?.report.findings[0]?.state).toBe("posted");
		// No-op: the stored blob is byte-identical (no needless rewrite).
		expect(db.select().from(prReviewFindings).get()?.findingsJson).toBe(
			before?.findingsJson,
		);
	});

	it("leaves the report untouched for an unknown findingId", () => {
		const report = makeReport();
		putFindings({ db, projectId, prNumber: 5, headSha: "sha-aaa", report });

		const result = markFindingPosted({
			db,
			projectId,
			prNumber: 5,
			findingId: "does-not-exist",
		});

		expect(result?.report.findings[0]?.state).toBe("open");
		expect(
			getCurrentFindings({ db, projectId, prNumber: 5 })?.report.findings[0]
				?.state,
		).toBe("open");
	});

	it("returns null when no review has been run for the PR", () => {
		expect(
			markFindingPosted({ db, projectId, prNumber: 404, findingId: "f-1" }),
		).toBeNull();
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
