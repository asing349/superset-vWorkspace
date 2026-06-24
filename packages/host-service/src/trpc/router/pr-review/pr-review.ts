import { z } from "zod";
import {
	buildGroundingServices,
	generateGuide,
	getCachedGuide,
	type PrReviewGuide,
} from "../../../runtime/pr-review/index";
import { createLocalAiSession } from "../../../runtime/pr-review/local-ai-session";
import { protectedProcedure, queryProcedure, router } from "../../index";
import { fetchPrDiff, type PrDiffResult } from "./fetch-pr-diff";

/**
 * `prReview` router (Wave 5). The host-side, read-only source for an ARBITRARY
 * repo PR's diff (M1) plus the on-demand, memory-grounded review Guide (M3/M4).
 * Composed into `appRouter` alongside the wave-4 `ticketContext` / `ticketRun`
 * routers.
 *
 * The renderer (window) consumes the contracts via
 * `inferRouterOutputs<AppRouter>["prReview"]`. M5 wires the guide's code anchors
 * to scroll the sibling Diff tab.
 */
export const prReviewRouter = router({
	/**
	 * Fetch the `base..head` diff of a PR (checked out locally or not), plus its
	 * `body` / `baseBranch` / `headSha`. Wraps the reusable {@link fetchPrDiff}
	 * core. Best-effort: when the PR/repo can't be resolved it returns an
	 * empty-but-typed result (empty `files`, `null` body) rather than throwing,
	 * so the renderer degrades to an empty diff instead of erroring.
	 *
	 * `pulls/{n}/files` (paginated) + `pulls/get` can take seconds for large
	 * PRs, so the timeout is widened past the 5s query default (mirrors the git
	 * router's diff procedures).
	 */
	getDiff: queryProcedure
		.meta({ timeoutMs: 30_000 })
		.input(
			z.object({
				projectId: z.string().min(1),
				prNumber: z.number().int().positive(),
			}),
		)
		.query(async ({ ctx, input }): Promise<PrDiffResult> => {
			return fetchPrDiff({
				db: ctx.db,
				github: ctx.github,
				git: ctx.git,
				projectId: input.projectId,
				prNumber: input.prNumber,
			});
		}),

	/**
	 * Generate the review Guide for a PR (Wave 5, M4). This MUTATION is THE ONLY
	 * trigger for guide generation — making it a mutation (not a query) is what
	 * structurally guarantees the wave-5 "never auto-generates on open/view/new
	 * commit" guardrail: queries (open/view) cannot reach this code path.
	 *
	 * Pipeline (all host-local): fetch the PR diff (M1) → build the deterministic
	 * + memory-grounded skeleton (M3) → IF a local AI session is connected,
	 * best-effort enrich it through the user's OWN on-device agent (M4) → persist
	 * to the host guide cache (M6). NO new Superset cloud model call: enrichment
	 * rides the user's connected agent, and degrades to the deterministic +
	 * grounded guide when none is available.
	 */
	generateGuide: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				prNumber: z.number().int().positive(),
			}),
		)
		.mutation(async ({ ctx, input }): Promise<PrReviewGuide> => {
			const grounding = buildGroundingServices({
				db: ctx.db,
				memoryRetrieve: ctx.runtime.memoryRetrieve,
				memoryIndex: ctx.runtime.memoryIndex,
				readPracticeVersion: (practiceInput) =>
					ctx.runtime.memoryRetrieve.readPracticeVersion(practiceInput),
			});

			// The user's own on-device agent, or null when none is connected.
			const session = createLocalAiSession({
				db: ctx.db,
				chat: ctx.runtime.chat,
				projectId: input.projectId,
			});

			return generateGuide({
				db: ctx.db,
				fetchDeps: { db: ctx.db, github: ctx.github, git: ctx.git },
				grounding,
				session,
				projectId: input.projectId,
				prNumber: input.prNumber,
			});
		}),

	/**
	 * Read the current cached Guide for a PR (Wave 5, M4/M6). The renderer calls
	 * this on open/view; it GENERATES NOTHING — it only reads what a prior
	 * `generateGuide` button press persisted. Returns `{ guide, stale }`, or
	 * `null` when no guide has been generated for this PR yet. `stale` is true
	 * once the PR's head SHA has advanced past the cached guide's (M6).
	 */
	getCachedGuide: queryProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				prNumber: z.number().int().positive(),
			}),
		)
		.query(
			({ ctx, input }): { guide: PrReviewGuide; stale: boolean } | null => {
				return getCachedGuide({
					db: ctx.db,
					projectId: input.projectId,
					prNumber: input.prNumber,
				});
			},
		),
});
