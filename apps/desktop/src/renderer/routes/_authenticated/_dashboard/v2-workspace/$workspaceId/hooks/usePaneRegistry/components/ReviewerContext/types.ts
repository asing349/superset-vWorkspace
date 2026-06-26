import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Reviewer-config types for the M5 onboarding / refresh / manage-context UI —
 * DERIVED from the host `reviewer` router output, the single source of truth
 * (a TYPE-ONLY import, erased at build, so the renderer stays browser-safe —
 * the same seam the Findings/Guide tabs use).
 */
type ReviewerOutputs = inferRouterOutputs<AppRouter>["reviewer"];

/** Per-project context status — exactly `reviewer.getContextStatus`. */
export type ReviewerContextStatus = ReviewerOutputs["getContextStatus"];

/** The persisted per-project reviewer config (nullable until set up). */
export type ReviewerConfig = ReviewerContextStatus["config"];

/** The on-demand diff of current context vs the configured snapshot. */
export type ReviewerContextDiff = ReviewerContextStatus["diff"];

/** One layer-level change within the diff ({ kind, detail }). */
export type ReviewerContextChange = ReviewerContextDiff["changes"][number];

/** `{ diff, config }` — exactly what `reviewer.refreshContext` returns. */
export type ReviewerRefreshResult = ReviewerOutputs["refreshContext"];

/**
 * Observed-business-rules types for the M6 curation UI — DERIVED from the host
 * `businessRules` router output (the single source of truth; a type-only import).
 */
type BusinessRulesOutputs = inferRouterOutputs<AppRouter>["businessRules"];

/** One persisted observed business rule — exactly `businessRules.list[number]`. */
export type ObservedRule = BusinessRulesOutputs["list"][number];

/** The curation lifecycle state of an observed rule. */
export type ObservedRuleState = ObservedRule["state"];
