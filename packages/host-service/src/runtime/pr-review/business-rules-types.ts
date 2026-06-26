import type { FindingCategory } from "./findings-types.ts";

/**
 * Observed business-rules artifact contract (Wave 6, M6).
 *
 * An observed business rule is a domain rule/invariant the reviewer INFERS at
 * review time (from the PR body + diff + project practice + playbook gotchas)
 * and persists as a new project-scoped memory layer — the BEHAVIORAL grounding
 * the structural project index ("where X lives") does not capture today. Curated
 * like the wave-3 practice consolidation (propose → accept → revert, versioned),
 * so the developer decides which rules become ACTIVE grounding.
 *
 * These types are PURE data (no Node-only deps), so they ride the `businessRules`
 * tRPC procedures and the renderer derives them via `inferRouterOutputs` (the
 * same browser-safe seam the Findings/Guide/Reviewer types use).
 */

/**
 * Curation lifecycle of an observed rule.
 *  - `proposed`  — inferred at review time, awaiting curation (NOT yet grounding).
 *  - `accepted`  — the developer accepted it; it now grounds later reviews.
 *  - `reverted`  — rejected proposal / retired rule; kept for audit, never deleted.
 */
export type ObservedRuleState = "proposed" | "accepted" | "reverted";

/**
 * One persisted observed business rule. `rule` is ALWAYS redacted (model text is
 * scrubbed before it is written — Assumption A3/A5). `version` is a monotonic
 * per-row counter bumped on every state transition (the auditable history).
 */
export interface ObservedRule {
	id: string;
	projectId: string;
	/** The REDACTED rule/invariant text. */
	rule: string;
	category: FindingCategory;
	state: ObservedRuleState;
	version: number;
	confidence: number;
	/** The PR the rule was inferred from, or null for a manual/seed rule. */
	sourcePrNumber: number | null;
	provenance: string | null;
	createdAt: number;
	updatedAt: number;
}

/**
 * A still-untrusted, just-inferred rule draft, BEFORE it is persisted. `rule` is
 * already redacted by {@link buildObservedRuleDrafts}; the store inserts it as a
 * `proposed` row (deduped against the project's existing non-reverted rules).
 */
export interface ObservedRuleDraft {
	/** The REDACTED rule/invariant text. */
	rule: string;
	category: FindingCategory;
	confidence: number;
	provenance: string | null;
}

/** A coarse summary of a project's observed rules (for the manage-context card). */
export interface ObservedRulesSummary {
	accepted: number;
	proposed: number;
	reverted: number;
}
