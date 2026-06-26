import { randomUUID } from "node:crypto";
import { contentHash } from "@superset/memory";
import { and, desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { prReviewObservedBusinessRules } from "../../db/schema.ts";
import type {
	ObservedRule,
	ObservedRuleDraft,
	ObservedRuleState,
	ObservedRulesSummary,
} from "./business-rules-types.ts";
import type { FindingCategory } from "./findings-types.ts";

/**
 * Observed business-rules store (Wave 6, M6) — pure db helpers (the wave-5/6
 * findings-cache / reviewer-config-cache style), keyed `(projectId)`. This is the
 * propose/accept/revert + versioning curation, mirroring the wave-3 practice
 * consolidation:
 *
 *  - `proposeObservedRules` — persist freshly-INFERRED rules as `proposed`
 *    (deduped against the project's existing non-reverted rules so re-review is
 *    idempotent). NEVER auto-accepted — the developer curates.
 *  - `acceptObservedRule` / `revertObservedRule` — the curation transitions; each
 *    bumps the row's monotonic `version` (the auditable, revertible history).
 *  - `getAcceptedObservedRules` — the ACCEPTED rules `buildGroundingServices`
 *    surfaces to later reviews (the compounding grounding).
 *  - `computeBusinessRulesSignature` — an FNV-1a over the accepted rules' ids +
 *    versions, folded into the reviewer-context snapshot so accept/revert moves
 *    the context hash (→ "Refresh context" detects it, like a practice change).
 *
 * All host-local (SQLite); no cloud schema change. The `rule` text is redacted
 * by the inference path BEFORE it reaches `proposeObservedRules` (Assumption
 * A3/A5 — nothing stored unredacted).
 */

const VALID_STATES: ReadonlySet<ObservedRuleState> = new Set<ObservedRuleState>(
	["proposed", "accepted", "reverted"],
);

const VALID_CATEGORIES: ReadonlySet<FindingCategory> = new Set<FindingCategory>(
	["correctness", "business-logic", "convention", "security", "perf"],
);

type ObservedRuleRow = typeof prReviewObservedBusinessRules.$inferSelect;

/** Coerce a stored `state` string back to the union (defaulting defensively). */
function toState(value: string): ObservedRuleState {
	return VALID_STATES.has(value as ObservedRuleState)
		? (value as ObservedRuleState)
		: "proposed";
}

/** Coerce a stored `category` string back to the union (defaulting defensively). */
function toCategory(value: string): FindingCategory {
	return VALID_CATEGORIES.has(value as FindingCategory)
		? (value as FindingCategory)
		: "business-logic";
}

function rowToObservedRule(row: ObservedRuleRow): ObservedRule {
	return {
		id: row.id,
		projectId: row.projectId,
		rule: row.rule,
		category: toCategory(row.category),
		state: toState(row.state),
		version: row.version,
		confidence: row.confidence,
		sourcePrNumber: row.sourcePrNumber,
		provenance: row.provenance,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** Normalize rule text for dedupe (case/whitespace-insensitive). */
function normalizeRuleText(rule: string): string {
	return rule.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * List a project's observed rules (newest write first), optionally filtered by
 * `state`. Reads only.
 */
export function listObservedRules({
	db,
	projectId,
	state,
}: {
	db: HostDb;
	projectId: string;
	state?: ObservedRuleState;
}): ObservedRule[] {
	const where =
		state === undefined
			? eq(prReviewObservedBusinessRules.projectId, projectId)
			: and(
					eq(prReviewObservedBusinessRules.projectId, projectId),
					eq(prReviewObservedBusinessRules.state, state),
				);
	return db
		.select()
		.from(prReviewObservedBusinessRules)
		.where(where)
		.orderBy(desc(prReviewObservedBusinessRules.updatedAt))
		.all()
		.map(rowToObservedRule);
}

/**
 * The ACCEPTED rules for a project — what `buildGroundingServices` surfaces to
 * later reviews (the compounding grounding). Newest first.
 */
export function getAcceptedObservedRules({
	db,
	projectId,
}: {
	db: HostDb;
	projectId: string;
}): ObservedRule[] {
	return listObservedRules({ db, projectId, state: "accepted" });
}

/** Coarse counts by state, for the manage-context card badge. */
export function summarizeObservedRules({
	db,
	projectId,
}: {
	db: HostDb;
	projectId: string;
}): ObservedRulesSummary {
	const rules = listObservedRules({ db, projectId });
	const summary: ObservedRulesSummary = {
		accepted: 0,
		proposed: 0,
		reverted: 0,
	};
	for (const rule of rules) summary[rule.state] += 1;
	return summary;
}

/**
 * Persist freshly-inferred rule drafts as `proposed` rows. Deduped against the
 * project's existing NON-reverted rules by normalized text (so re-reviewing the
 * same PR — or a different PR that restates a known rule — does not pile up
 * duplicates). Nothing is auto-accepted. Returns the rules actually inserted.
 *
 * The `rule` text MUST already be redacted by the caller (the inference path) —
 * this store does no redaction of its own.
 */
export function proposeObservedRules({
	db,
	projectId,
	drafts,
	sourcePrNumber,
}: {
	db: HostDb;
	projectId: string;
	drafts: readonly ObservedRuleDraft[];
	sourcePrNumber: number | null;
}): ObservedRule[] {
	if (drafts.length === 0) return [];

	// Existing non-reverted rules guard against re-proposing a known rule.
	const existing = db
		.select({
			rule: prReviewObservedBusinessRules.rule,
			state: prReviewObservedBusinessRules.state,
		})
		.from(prReviewObservedBusinessRules)
		.where(eq(prReviewObservedBusinessRules.projectId, projectId))
		.all();
	const known = new Set(
		existing
			.filter((row) => row.state !== "reverted")
			.map((row) => normalizeRuleText(row.rule)),
	);

	const inserted: ObservedRule[] = [];
	const now = Date.now();
	for (const draft of drafts) {
		const text = draft.rule.trim();
		if (text.length === 0) continue;
		const key = normalizeRuleText(text);
		// Skip duplicates within this batch AND against already-known rules.
		if (known.has(key)) continue;
		known.add(key);

		const id = randomUUID();
		db.insert(prReviewObservedBusinessRules)
			.values({
				id,
				projectId,
				rule: text,
				category: draft.category,
				state: "proposed",
				version: 1,
				confidence: draft.confidence,
				sourcePrNumber,
				provenance: draft.provenance,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const row = db
			.select()
			.from(prReviewObservedBusinessRules)
			.where(eq(prReviewObservedBusinessRules.id, id))
			.get();
		if (row) inserted.push(rowToObservedRule(row));
	}
	return inserted;
}

/** Flip one rule to a new `state`, bumping its version. Returns null if absent. */
function transitionRule({
	db,
	projectId,
	ruleId,
	nextState,
}: {
	db: HostDb;
	projectId: string;
	ruleId: string;
	nextState: ObservedRuleState;
}): ObservedRule | null {
	const row = db
		.select()
		.from(prReviewObservedBusinessRules)
		.where(
			and(
				eq(prReviewObservedBusinessRules.id, ruleId),
				eq(prReviewObservedBusinessRules.projectId, projectId),
			),
		)
		.get();
	if (!row) return null;

	// Idempotent: already in the target state → return as-is (no version bump).
	if (row.state === nextState) return rowToObservedRule(row);

	db.update(prReviewObservedBusinessRules)
		.set({
			state: nextState,
			version: row.version + 1,
			updatedAt: Date.now(),
		})
		.where(eq(prReviewObservedBusinessRules.id, ruleId))
		.run();

	const updated = db
		.select()
		.from(prReviewObservedBusinessRules)
		.where(eq(prReviewObservedBusinessRules.id, ruleId))
		.get();
	return updated ? rowToObservedRule(updated) : null;
}

/**
 * ACCEPT a rule — the developer curates a proposal (or a retired rule) into
 * ACTIVE grounding. Flips `state` to `accepted` and bumps `version`. Idempotent
 * for an already-accepted rule; null when the rule doesn't exist.
 */
export function acceptObservedRule({
	db,
	projectId,
	ruleId,
}: {
	db: HostDb;
	projectId: string;
	ruleId: string;
}): ObservedRule | null {
	return transitionRule({ db, projectId, ruleId, nextState: "accepted" });
}

/**
 * REVERT a rule — reject a proposal or retire an accepted rule from grounding.
 * Flips `state` to `reverted` and bumps `version` (the row is kept for audit,
 * never deleted). Idempotent for an already-reverted rule; null when absent.
 */
export function revertObservedRule({
	db,
	projectId,
	ruleId,
}: {
	db: HostDb;
	projectId: string;
	ruleId: string;
}): ObservedRule | null {
	return transitionRule({ db, projectId, ruleId, nextState: "reverted" });
}

/**
 * An FNV-1a signature of the ACCEPTED rules (their ids + versions), order-
 * independent. Folded into the reviewer-context snapshot so accepting/reverting
 * a rule moves the context hash — making "Refresh context" detect an
 * observed-business-rules change exactly as it detects a practice/index change.
 * An empty accepted set hashes to a stable value (so no-rules is not "changed").
 */
export function computeBusinessRulesSignature(
	rules: readonly Pick<ObservedRule, "id" | "version">[],
): string {
	const canonical = rules
		.map((rule) => `${rule.id}:${rule.version}`)
		.sort()
		.join("|");
	return contentHash(canonical);
}
