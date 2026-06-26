import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { FindingsReport } from "../../types";

export interface UseReviewPrArgs {
	projectId: string;
	prNumber: number;
}

export interface UseReviewPrResult {
	/** The cached or freshly-produced findings report, or null when none yet. */
	report: FindingsReport | null;
	/** True while a review is in flight (the button's pending state). */
	isReviewing: boolean;
	/** True while the cache is still being read (gates empty-vs-loading copy). */
	isLoadingCached: boolean;
	/**
	 * Whether the cached findings are stale vs the PR's current head SHA — i.e.
	 * new commits landed since the review. Drives the "stale — Re-review"
	 * affordance. Never triggers anything on its own.
	 */
	isStale: boolean;
	/** Trigger a review. The ONLY way findings are ever produced (button-only). */
	review: () => void;
}

/**
 * Owns the Findings tab's data + review flow (Wave 6, M1) — the wave-5
 * `useGenerateGuide` pattern, verbatim.
 *
 * Read path (cache-first): `prReview.getCachedFindings` is a QUERY that REVIEWS
 * NOTHING — it only returns what a prior button press persisted
 * (`{ report, stale } | null`). On open/view we render the cached report (or the
 * empty state when null) immediately; `isLoadingCached` only chooses the
 * empty-vs-loading copy.
 *
 * Write path (button-only): `prReview.reviewPr` is a MUTATION — the host made it
 * a mutation precisely so queries (open/view/tab-switch) can't reach it.
 * `review` is the sole caller and is invoked ONLY from the button's onClick
 * (never an effect / onMount), so review stays explicit. On success we
 * invalidate `getCachedFindings` so the freshly-persisted report (and its now-
 * fresh `stale:false`) flows back through the read path — one source of truth.
 */
export function useReviewPr({
	projectId,
	prNumber,
}: UseReviewPrArgs): UseReviewPrResult {
	const utils = workspaceTrpc.useUtils();

	const cachedQuery = workspaceTrpc.prReview.getCachedFindings.useQuery(
		{ projectId, prNumber },
		// The cache is read-only and changes only on an explicit (re)review, so it
		// never needs background refetching.
		{ staleTime: Number.POSITIVE_INFINITY },
	);

	const reviewMutation = workspaceTrpc.prReview.reviewPr.useMutation({
		onSuccess: () => {
			// Re-read the cache so the persisted report + fresh staleness render via
			// the single read path (rather than mirroring the mutation result).
			void utils.prReview.getCachedFindings.invalidate({ projectId, prNumber });
		},
		onError: (error) => {
			toast.error("Couldn't review this PR", { description: error.message });
		},
	});

	const review = useCallback(() => {
		// Sole trigger. Called only from the Review / Re-review button onClick.
		reviewMutation.mutate({ projectId, prNumber });
	}, [reviewMutation, projectId, prNumber]);

	const cached = cachedQuery.data ?? null;

	return {
		report: cached?.report ?? null,
		isReviewing: reviewMutation.isPending,
		isLoadingCached: cachedQuery.isLoading,
		isStale: cached?.stale ?? false,
		review,
	};
}
