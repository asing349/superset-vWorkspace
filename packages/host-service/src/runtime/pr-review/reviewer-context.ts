import { contentHash, isFingerprintStale } from "@superset/memory";

/**
 * Reviewer-context snapshot + change-detection helpers (Wave 6, M5) — PURE
 * LOGIC, no db / no I/O, so the change detection is unit-testable in isolation.
 *
 * The "context" is the wave-3 memory the AI reviewer grounds on: the project +
 * global Coding Practice (versioned), the Project Index ("where X lives", with a
 * `commitSha` / `lastIndexedAt`), and the Playbooks. When a developer onboards
 * the reviewer ("Set up AI reviewer"), we snapshot a fingerprint of that context
 * — the practice version ids, the index state, and a hash of the grounding
 * settings — plus an overall `contextHash`.
 *
 * "Refresh context" re-reads the CURRENT context and diffs it against the stored
 * snapshot via {@link diffReviewerContext} (built on the wave-3
 * `contentHash` / `isFingerprintStale` primitives). It reports WHAT changed and
 * re-baselines only on an explicit user click — it NEVER auto-runs (the
 * wave-5/6 "detect change → offer refresh" guardrail). The app.ts listeners only
 * flip a cheap `stale` flag; the authoritative diff is computed here on demand.
 */

/**
 * The wave-3 memory layers the AI reviewer grounds on by default — the same set
 * `buildGroundingServices` assembles (practice + index + playbooks). Stored on
 * the config so a future onboarding can scope grounding per project.
 */
export const DEFAULT_REVIEWER_GROUNDING_LAYERS = [
	"practice-project",
	"practice-global",
	"project-index",
	"playbooks",
] as const;

export type ReviewerGroundingLayer =
	(typeof DEFAULT_REVIEWER_GROUNDING_LAYERS)[number];

/**
 * The raw, comparable context inputs gathered from memory at a point in time.
 * Both the snapshot (at setup/refresh) and the "current" read (at diff time) are
 * this shape; the snapshot additionally carries the derived hashes.
 */
export interface ReviewerContextInputs {
	/** Grounding-layer ids the reviewer is configured on. */
	groundingLayers: string[];
	practiceProjectVersionId: string | null;
	practiceProjectVersion: number | null;
	practiceGlobalVersionId: string | null;
	practiceGlobalVersion: number | null;
	indexCommitSha: string | null;
	indexLastIndexedAt: number | null;
	indexEntryCount: number;
}

/** A persisted snapshot = the inputs plus their derived FNV-1a fingerprints. */
export interface ReviewerContextSnapshot extends ReviewerContextInputs {
	/** FNV-1a of the grounding settings (which layers are on). */
	settingsHash: string;
	/** FNV-1a of the whole snapshot — the single value the refresh diffs. */
	contextHash: string;
}

/** Dedupe + sort grounding layers so hashing is order-independent. */
export function normalizeGroundingLayers(layers: readonly string[]): string[] {
	return [...new Set(layers)].sort();
}

/**
 * FNV-1a hash of the grounding settings (the "settings/feature hash"). Only the
 * set of grounding layers is settings today; sorting makes it order-independent.
 */
export function computeSettingsHash(input: {
	groundingLayers: readonly string[];
}): string {
	return contentHash(
		JSON.stringify({
			groundingLayers: normalizeGroundingLayers(input.groundingLayers),
		}),
	);
}

/**
 * FNV-1a hash of the entire context snapshot — the practice version ids, the
 * index state, and the grounding layers. This is the single fingerprint the
 * refresh compares via `isFingerprintStale`. Practice/index VALUES (not just
 * versions) are captured through the version ids + commit sha + last-indexed
 * timestamp + entry count, so any consolidation, reindex, or settings change
 * moves the hash.
 */
export function computeContextHash(inputs: ReviewerContextInputs): string {
	const canonical = {
		groundingLayers: normalizeGroundingLayers(inputs.groundingLayers),
		practiceProjectVersionId: inputs.practiceProjectVersionId,
		practiceGlobalVersionId: inputs.practiceGlobalVersionId,
		indexCommitSha: inputs.indexCommitSha,
		indexLastIndexedAt: inputs.indexLastIndexedAt,
		indexEntryCount: inputs.indexEntryCount,
	};
	return contentHash(JSON.stringify(canonical));
}

/** Build a full snapshot (inputs + hashes) for persistence at setup/refresh. */
export function buildReviewerContextSnapshot(
	inputs: ReviewerContextInputs,
): ReviewerContextSnapshot {
	return {
		...inputs,
		groundingLayers: normalizeGroundingLayers(inputs.groundingLayers),
		settingsHash: computeSettingsHash({
			groundingLayers: inputs.groundingLayers,
		}),
		contextHash: computeContextHash(inputs),
	};
}

export type ReviewerContextChangeKind =
	| "practice-project"
	| "practice-global"
	| "project-index"
	| "settings";

export interface ReviewerContextChange {
	kind: ReviewerContextChangeKind;
	/** Human-readable summary of the change (e.g. "Project practice v2 → v3"). */
	detail: string;
}

export interface ReviewerContextDiff {
	/** Whether the current context's fingerprint differs from the snapshot's. */
	changed: boolean;
	/** The per-layer breakdown of what changed (empty when nothing did). */
	changes: ReviewerContextChange[];
}

function describeVersion(
	label: string,
	from: number | null,
	to: number | null,
): string {
	const f = from === null ? "none" : `v${from}`;
	const t = to === null ? "none" : `v${to}`;
	return `${label} ${f} → ${t}`;
}

/**
 * Diff the CURRENT context against a stored snapshot. `changed` is the
 * authoritative signal (via `isFingerprintStale` over the overall `contextHash`);
 * `changes` enumerates WHICH layers moved so the UI can show what changed before
 * the user clicks Refresh. Identical context ⇒ `{ changed: false, changes: [] }`.
 */
export function diffReviewerContext(input: {
	snapshot: ReviewerContextSnapshot;
	current: ReviewerContextInputs;
}): ReviewerContextDiff {
	const { snapshot, current } = input;

	const currentContextHash = computeContextHash(current);
	const changed = isFingerprintStale({
		previousHash: snapshot.contextHash,
		currentHash: currentContextHash,
	});

	const changes: ReviewerContextChange[] = [];

	if (snapshot.practiceProjectVersionId !== current.practiceProjectVersionId) {
		changes.push({
			kind: "practice-project",
			detail: describeVersion(
				"Project practice",
				snapshot.practiceProjectVersion,
				current.practiceProjectVersion,
			),
		});
	}

	if (snapshot.practiceGlobalVersionId !== current.practiceGlobalVersionId) {
		changes.push({
			kind: "practice-global",
			detail: describeVersion(
				"Global practice",
				snapshot.practiceGlobalVersion,
				current.practiceGlobalVersion,
			),
		});
	}

	if (
		snapshot.indexCommitSha !== current.indexCommitSha ||
		snapshot.indexLastIndexedAt !== current.indexLastIndexedAt ||
		snapshot.indexEntryCount !== current.indexEntryCount
	) {
		changes.push({
			kind: "project-index",
			detail: `Project index updated (${current.indexEntryCount} entries)`,
		});
	}

	const currentSettingsHash = computeSettingsHash({
		groundingLayers: current.groundingLayers,
	});
	if (snapshot.settingsHash !== currentSettingsHash) {
		changes.push({
			kind: "settings",
			detail: "Grounding layers changed",
		});
	}

	return { changed, changes };
}
