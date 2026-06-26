import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { HostDb } from "../../db";
import { prReviewFindings } from "../../db/schema";
import type { FindingsReport } from "./findings-types";

/**
 * PR-review Findings cache (Wave 6, M1). Mirrors the wave-5 guide-cache exactly:
 *  - `putFindings` / `getCurrentFindings` — persist + read the `FindingsReport`,
 *    keyed `(projectId, prNumber, headSha)`. The `reviewPr` mutation writes here;
 *    the renderer reads the current report + its `stale` flag (it NEVER reviews).
 *  - `markFindingsStaleOnHeadChange` — flips `stale=true` on any cached findings
 *    whose head SHA no longer matches the PR's current head. This is the ENTIRE
 *    "new commits invalidate the findings" mechanism: it re-reviews NOTHING — it
 *    only marks, so the renderer can offer a "Re-review" button (the button-only
 *    guardrail carried from wave-5).
 *
 * All host-local (SQLite); no cloud schema change. The report (findings array +
 * per-finding `state`) is stored as JSON text and parsed back on read.
 */

/**
 * Upsert the findings report for `(projectId, prNumber, headSha)`. A fresh write
 * always resets `stale=false` (the report is current for this head SHA by
 * definition). Re-running for the same key REPLACES the row (never duplicates),
 * via the unique `(project_id, pr_number, head_sha)` index.
 */
export function putFindings({
	db,
	projectId,
	prNumber,
	headSha,
	report,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	headSha: string;
	report: FindingsReport;
}): void {
	const findingsJson = JSON.stringify(report);
	const now = Date.now();

	const existing = db
		.select({ id: prReviewFindings.id })
		.from(prReviewFindings)
		.where(
			and(
				eq(prReviewFindings.projectId, projectId),
				eq(prReviewFindings.prNumber, prNumber),
				eq(prReviewFindings.headSha, headSha),
			),
		)
		.get();

	if (existing) {
		db.update(prReviewFindings)
			.set({ findingsJson, stale: false, updatedAt: now })
			.where(eq(prReviewFindings.id, existing.id))
			.run();
		return;
	}

	db.insert(prReviewFindings)
		.values({
			id: randomUUID(),
			projectId,
			prNumber,
			headSha,
			findingsJson,
			stale: false,
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

/**
 * Return the latest cached findings for a PR (the most-recently-written row,
 * regardless of head SHA), parsed back into a `FindingsReport` along with the
 * `headSha` it was built against and its `stale` flag. Returns `null` when no
 * review has been run for this PR yet.
 */
export function getCurrentFindings({
	db,
	projectId,
	prNumber,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
}): { report: FindingsReport; headSha: string; stale: boolean } | null {
	const row = db
		.select({
			findingsJson: prReviewFindings.findingsJson,
			headSha: prReviewFindings.headSha,
			stale: prReviewFindings.stale,
		})
		.from(prReviewFindings)
		.where(
			and(
				eq(prReviewFindings.projectId, projectId),
				eq(prReviewFindings.prNumber, prNumber),
			),
		)
		// Newest write is the "current" report for the PR.
		.orderBy(desc(prReviewFindings.updatedAt))
		.get();

	if (!row) return null;

	return {
		report: JSON.parse(row.findingsJson) as FindingsReport,
		headSha: row.headSha,
		stale: row.stale,
	};
}

/**
 * Mark every cached findings row for `(projectId, prNumber)` whose head SHA
 * differs from `newHeadSha` as `stale`. Called when a PR's head advances (a new
 * commit). It does EXACTLY ONE thing — flip the flag — and triggers NO re-review:
 * re-review is only ever the explicit user button (the button-only guardrail).
 * Idempotent: a report already at `newHeadSha` is left untouched.
 */
export function markFindingsStaleOnHeadChange({
	db,
	projectId,
	prNumber,
	newHeadSha,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	newHeadSha: string;
}): void {
	db.update(prReviewFindings)
		.set({ stale: true, updatedAt: Date.now() })
		.where(
			and(
				eq(prReviewFindings.projectId, projectId),
				eq(prReviewFindings.prNumber, prNumber),
				ne(prReviewFindings.headSha, newHeadSha),
			),
		)
		.run();
}
