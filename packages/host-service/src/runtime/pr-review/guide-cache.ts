import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { HostDb } from "../../db";
import { prReviewDiffs, prReviewGuides } from "../../db/schema";
import type { PrReviewGuide } from "./guide-types";

/**
 * PR-review Guide + diff cache (Wave 5, M6). The SHARED storage layer for the
 * `prReview` feature:
 *  - `putGuide` / `getCurrentGuide` — persist + read the generated guide,
 *    keyed `(projectId, prNumber, headSha)`. M4's `generateGuide` writes here;
 *    the renderer reads the current guide + its `stale` flag.
 *  - `markGuideStaleOnHeadChange` — flips `stale=true` on any cached guide whose
 *    head SHA no longer matches the PR's current head. This is the ENTIRE
 *    "new commits invalidate the guide" mechanism: it regenerates NOTHING — it
 *    only marks, so the renderer can offer a "Regenerate" button (the wave-5
 *    never-auto-generate guardrail).
 *  - `putDiff` / `getDiff` — cache M1's fetched `PrDiffResult` for the same key
 *    so a re-open / regenerate need not re-fetch GitHub.
 *
 * All host-local (SQLite); no cloud schema change. The guide/diff payloads are
 * stored as JSON text and parsed back on read. M4 imports this module by PATH
 * (`./guide-cache`) — `runtime/pr-review/index.ts` is owned by the guide
 * generator and is intentionally NOT touched here.
 */

/** A diff payload as M1 (`prReview.getDiff`) produces it. Stored as JSON. */
export interface PrDiffResultLike {
	files: Array<{
		filename: string;
		status: string;
		patch: string | null;
		additions: number;
		deletions: number;
		previousFilename?: string;
	}>;
	body: string | null;
	baseBranch: string;
	headSha: string;
	prNumber: number;
}

// ---------------------------------------------------------------------------
// Guide cache
// ---------------------------------------------------------------------------

/**
 * Upsert the guide for `(projectId, prNumber, headSha)`. A fresh write always
 * resets `stale=false` (the guide is current for this head SHA by definition).
 * Re-running for the same key REPLACES the row (never duplicates), via the
 * unique `(project_id, pr_number, head_sha)` index.
 */
export function putGuide({
	db,
	projectId,
	prNumber,
	headSha,
	guide,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	headSha: string;
	guide: PrReviewGuide;
}): void {
	const guideJson = JSON.stringify(guide);
	const now = Date.now();

	const existing = db
		.select({ id: prReviewGuides.id })
		.from(prReviewGuides)
		.where(
			and(
				eq(prReviewGuides.projectId, projectId),
				eq(prReviewGuides.prNumber, prNumber),
				eq(prReviewGuides.headSha, headSha),
			),
		)
		.get();

	if (existing) {
		db.update(prReviewGuides)
			.set({ guideJson, stale: false, updatedAt: now })
			.where(eq(prReviewGuides.id, existing.id))
			.run();
		return;
	}

	db.insert(prReviewGuides)
		.values({
			id: randomUUID(),
			projectId,
			prNumber,
			headSha,
			guideJson,
			stale: false,
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

/**
 * Return the latest cached guide for a PR (the most-recently-written row,
 * regardless of head SHA), parsed back into a `PrReviewGuide` along with the
 * `headSha` it was built against and its `stale` flag. Returns `null` when no
 * guide has been generated for this PR yet.
 */
export function getCurrentGuide({
	db,
	projectId,
	prNumber,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
}): { guide: PrReviewGuide; headSha: string; stale: boolean } | null {
	const row = db
		.select({
			guideJson: prReviewGuides.guideJson,
			headSha: prReviewGuides.headSha,
			stale: prReviewGuides.stale,
		})
		.from(prReviewGuides)
		.where(
			and(
				eq(prReviewGuides.projectId, projectId),
				eq(prReviewGuides.prNumber, prNumber),
			),
		)
		// Newest write is the "current" guide for the PR.
		.orderBy(desc(prReviewGuides.updatedAt))
		.get();

	if (!row) return null;

	return {
		guide: JSON.parse(row.guideJson) as PrReviewGuide,
		headSha: row.headSha,
		stale: row.stale,
	};
}

/**
 * Mark every cached guide for `(projectId, prNumber)` whose head SHA differs
 * from `newHeadSha` as `stale`. Called when a PR's head advances (M6 staleness
 * wiring). It does EXACTLY ONE thing — flip the flag — and triggers NO guide
 * regeneration: regeneration is only ever the explicit user button (the wave-5
 * never-auto-generate guardrail). Idempotent: re-running with the same head SHA
 * re-marks the same rows (a guide already at `newHeadSha` is left untouched).
 */
export function markGuideStaleOnHeadChange({
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
	db.update(prReviewGuides)
		.set({ stale: true, updatedAt: Date.now() })
		.where(
			and(
				eq(prReviewGuides.projectId, projectId),
				eq(prReviewGuides.prNumber, prNumber),
				ne(prReviewGuides.headSha, newHeadSha),
			),
		)
		.run();
}

// ---------------------------------------------------------------------------
// Diff cache
// ---------------------------------------------------------------------------

/**
 * Upsert M1's fetched diff for `(projectId, prNumber, headSha)`. A diff is
 * immutable for a given head SHA, so re-running for the same key just refreshes
 * the stored payload (no staleness concept). Returns nothing.
 */
export function putDiff({
	db,
	projectId,
	prNumber,
	headSha,
	diff,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	headSha: string;
	diff: PrDiffResultLike;
}): void {
	const diffJson = JSON.stringify(diff);
	const now = Date.now();

	const existing = db
		.select({ id: prReviewDiffs.id })
		.from(prReviewDiffs)
		.where(
			and(
				eq(prReviewDiffs.projectId, projectId),
				eq(prReviewDiffs.prNumber, prNumber),
				eq(prReviewDiffs.headSha, headSha),
			),
		)
		.get();

	if (existing) {
		db.update(prReviewDiffs)
			.set({ diffJson })
			.where(eq(prReviewDiffs.id, existing.id))
			.run();
		return;
	}

	db.insert(prReviewDiffs)
		.values({
			id: randomUUID(),
			projectId,
			prNumber,
			headSha,
			diffJson,
			createdAt: now,
		})
		.run();
}

/**
 * Read the cached diff for an exact `(projectId, prNumber, headSha)`. Returns
 * the parsed `PrDiffResult`, or `null` when nothing is cached for that head SHA.
 */
export function getDiff({
	db,
	projectId,
	prNumber,
	headSha,
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	headSha: string;
}): PrDiffResultLike | null {
	const row = db
		.select({ diffJson: prReviewDiffs.diffJson })
		.from(prReviewDiffs)
		.where(
			and(
				eq(prReviewDiffs.projectId, projectId),
				eq(prReviewDiffs.prNumber, prNumber),
				eq(prReviewDiffs.headSha, headSha),
			),
		)
		.get();

	if (!row) return null;

	return JSON.parse(row.diffJson) as PrDiffResultLike;
}
