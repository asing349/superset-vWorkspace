import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { prReviewReviewerConfig } from "../../db/schema.ts";
import {
	normalizeGroundingLayers,
	type ReviewerContextSnapshot,
} from "./reviewer-context.ts";

/**
 * Host-local store for the per-project AI-reviewer config (Wave 6, M5) —
 * mirrors the wave-5/6 findings-cache style (pure db helpers the router + the
 * app.ts listeners call). The reviewer config is ONE row per project
 * (`pr_review_reviewer_config`, unique `(project_id)`):
 *
 *  - `getReviewerConfigRow` / `upsertReviewerConfig` — read + write the config
 *    and its context snapshot. `setup` / `refreshContext` write here; the
 *    renderer reads the config + its staleness (it NEVER onboards on its own).
 *  - `markReviewerContextStale` — flips `stale=true` (FLAG-ONLY) when the
 *    project's context moves (practice written / index refreshed / PR head
 *    changed). This is the ENTIRE "context changed" listener mechanism: it
 *    re-snapshots NOTHING and offers NO refresh — it only marks, so the UI can
 *    surface a "Refresh context" affordance (the button-only guardrail).
 *
 * All host-local (SQLite); no cloud schema change. Nothing here is free model
 * text — only enum layer ids, version ids and hashes — so there is nothing to
 * redact (Assumption A3/A5).
 */

export type ReviewerConfigRow = typeof prReviewReviewerConfig.$inferSelect;

/** Parse the stored grounding-layers JSON string array (best-effort). */
export function parseGroundingLayers(value: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((item): item is string => typeof item === "string");
}

/** Reconstruct a `ReviewerContextSnapshot` from a persisted config row. */
export function snapshotFromRow(
	row: ReviewerConfigRow,
): ReviewerContextSnapshot {
	return {
		groundingLayers: parseGroundingLayers(row.groundingLayersJson),
		practiceProjectVersionId: row.practiceProjectVersionId,
		practiceProjectVersion: row.practiceProjectVersion,
		practiceGlobalVersionId: row.practiceGlobalVersionId,
		practiceGlobalVersion: row.practiceGlobalVersion,
		indexCommitSha: row.indexCommitSha,
		indexLastIndexedAt: row.indexLastIndexedAt,
		indexEntryCount: row.indexEntryCount,
		settingsHash: row.settingsHash,
		contextHash: row.contextHash,
	};
}

/** Read the reviewer-config row for a project, or undefined when not set up. */
export function getReviewerConfigRow({
	db,
	projectId,
}: {
	db: HostDb;
	projectId: string;
}): ReviewerConfigRow | undefined {
	return db
		.select()
		.from(prReviewReviewerConfig)
		.where(eq(prReviewReviewerConfig.projectId, projectId))
		.get();
}

/**
 * Upsert the reviewer config + context snapshot for a project, keyed
 * `(projectId)`. Re-running (setup again / refresh) REPLACES the row (never
 * duplicates) and resets `stale=false` — a fresh snapshot is current by
 * definition. Returns the persisted row.
 */
export function upsertReviewerConfig({
	db,
	projectId,
	enabled,
	snapshot,
	configuredBy,
}: {
	db: HostDb;
	projectId: string;
	enabled: boolean;
	snapshot: ReviewerContextSnapshot;
	configuredBy?: string | null;
}): ReviewerConfigRow {
	const now = Date.now();
	const values = {
		enabled,
		groundingLayersJson: JSON.stringify(
			normalizeGroundingLayers(snapshot.groundingLayers),
		),
		practiceProjectVersionId: snapshot.practiceProjectVersionId,
		practiceProjectVersion: snapshot.practiceProjectVersion,
		practiceGlobalVersionId: snapshot.practiceGlobalVersionId,
		practiceGlobalVersion: snapshot.practiceGlobalVersion,
		indexCommitSha: snapshot.indexCommitSha,
		indexLastIndexedAt: snapshot.indexLastIndexedAt,
		indexEntryCount: snapshot.indexEntryCount,
		settingsHash: snapshot.settingsHash,
		contextHash: snapshot.contextHash,
		stale: false,
		configuredBy: configuredBy ?? null,
		updatedAt: now,
	};

	const existing = getReviewerConfigRow({ db, projectId });
	if (existing) {
		db.update(prReviewReviewerConfig)
			.set(values)
			.where(eq(prReviewReviewerConfig.id, existing.id))
			.run();
	} else {
		db.insert(prReviewReviewerConfig)
			.values({
				id: randomUUID(),
				projectId,
				createdAt: now,
				...values,
			})
			.run();
	}

	const row = getReviewerConfigRow({ db, projectId });
	if (!row) {
		throw new Error("Failed to read back reviewer config");
	}
	return row;
}

/**
 * Flip the project's reviewer context to `stale=true` (FLAG-ONLY). Called from
 * the app.ts listeners when the project's context moves. It does EXACTLY ONE
 * thing — set the flag — and triggers NO re-snapshot / refresh (the button-only
 * guardrail). Idempotent: a config already stale (or a project with no config)
 * is left untouched (the `stale=false` filter makes it a true no-op).
 */
export function markReviewerContextStale({
	db,
	projectId,
}: {
	db: HostDb;
	projectId: string;
}): void {
	db.update(prReviewReviewerConfig)
		.set({ stale: true, updatedAt: Date.now() })
		.where(
			and(
				eq(prReviewReviewerConfig.projectId, projectId),
				eq(prReviewReviewerConfig.stale, false),
			),
		)
		.run();
}
