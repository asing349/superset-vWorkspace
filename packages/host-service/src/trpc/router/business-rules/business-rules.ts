import { z } from "zod";
import {
	acceptObservedRule,
	listObservedRules,
	markReviewerContextStale,
	type ObservedRule,
	type ObservedRulesSummary,
	revertObservedRule,
	summarizeObservedRules,
} from "../../../runtime/pr-review/index";
import { protectedProcedure, queryProcedure, router } from "../../index";

/**
 * `businessRules` router (Wave 6, M6). The host-side curation of the AI
 * reviewer's OBSERVED BUSINESS RULES memory layer — the compounding grounding
 * the reviewer writes at review time and the developer curates (propose →
 * accept → revert, versioned), mirroring the wave-3 practice consolidation
 * (`memory.consolidatePractice`/`acceptPractice`/`revertPractice`).
 *
 * PROPOSE is NOT a public mutation: rules are proposed automatically (and only)
 * during an explicit `prReview.reviewPr` run, redacted, never auto-accepted.
 * This router is the curation surface — list + accept + revert — which the
 * Manage-context view (`ReviewerContextCard`) drives. Accept/revert change what
 * later reviews ground on, so each flags the project's reviewer context `stale`
 * (flag-only — never an automatic refresh; the wave-5/6 button-only guardrail).
 *
 * Host-local (SQLite); no cloud schema change. Stored rule text is already
 * redacted at inference time (Assumption A3/A5).
 */

const ruleStateSchema = z.enum(["proposed", "accepted", "reverted"]);

export const businessRulesRouter = router({
	/**
	 * List a project's observed business rules (newest first), optionally filtered
	 * by curation `state`. Reads only — surfaces pending proposals + accepted rules
	 * to the Manage-context card.
	 */
	list: queryProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				state: ruleStateSchema.optional(),
			}),
		)
		.query(({ ctx, input }): ObservedRule[] => {
			return listObservedRules({
				db: ctx.db,
				projectId: input.projectId,
				state: input.state,
			});
		}),

	/** Coarse counts by state for a project (manage-context badge). Reads only. */
	summary: queryProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(({ ctx, input }): ObservedRulesSummary => {
			return summarizeObservedRules({
				db: ctx.db,
				projectId: input.projectId,
			});
		}),

	/**
	 * ACCEPT a rule — curate a proposal (or a retired rule) into ACTIVE grounding.
	 * Bumps the rule's version and flags the reviewer context `stale` so the UI can
	 * offer a refresh. The ONLY trigger is an explicit user click. Returns the
	 * updated rule, or null when the rule doesn't exist for this project.
	 */
	accept: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				ruleId: z.string().min(1),
			}),
		)
		.mutation(({ ctx, input }): ObservedRule | null => {
			const updated = acceptObservedRule({
				db: ctx.db,
				projectId: input.projectId,
				ruleId: input.ruleId,
			});
			if (updated) {
				markReviewerContextStale({ db: ctx.db, projectId: input.projectId });
			}
			return updated;
		}),

	/**
	 * REVERT a rule — reject a proposal or retire an accepted rule from grounding.
	 * Bumps the rule's version (the row is kept for audit) and flags the reviewer
	 * context `stale`. The ONLY trigger is an explicit user click. Returns the
	 * updated rule, or null when the rule doesn't exist for this project.
	 */
	revert: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				ruleId: z.string().min(1),
			}),
		)
		.mutation(({ ctx, input }): ObservedRule | null => {
			const updated = revertObservedRule({
				db: ctx.db,
				projectId: input.projectId,
				ruleId: input.ruleId,
			});
			if (updated) {
				markReviewerContextStale({ db: ctx.db, projectId: input.projectId });
			}
			return updated;
		}),
});
