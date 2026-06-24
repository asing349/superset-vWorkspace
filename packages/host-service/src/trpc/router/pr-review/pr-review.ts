import { z } from "zod";
import { queryProcedure, router } from "../../index";
import { fetchPrDiff, type PrDiffResult } from "./fetch-pr-diff";

/**
 * `prReview` router (Wave 5, M1). The host-side, read-only source for an
 * ARBITRARY repo PR's diff — every PR in the repo, not just the one checked
 * out locally. Composed into `appRouter` alongside the wave-4 `ticketContext` /
 * `ticketRun` routers.
 *
 * The renderer (window) consumes the contract via
 * `inferRouterOutputs<AppRouter>["prReview"]["getDiff"]` and runs `@pierre/diffs`
 * `parseDiffFromFile` on each file's raw `patch`; the guide (M3/M4) reads
 * filenames + patches for grounding. The HOST returns RAW patches, NOT parsed
 * items.
 *
 * M6 (cache + manual staleness) will layer onto this once the guide shape (M4)
 * is known.
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
});
