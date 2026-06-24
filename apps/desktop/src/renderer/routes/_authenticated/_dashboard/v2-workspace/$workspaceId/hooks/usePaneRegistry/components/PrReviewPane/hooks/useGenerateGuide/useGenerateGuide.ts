import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { PrReviewGuide } from "../../types";

export interface UseGenerateGuideArgs {
	projectId: string;
	prNumber: number;
}

export interface UseGenerateGuideResult {
	/** The cached or freshly-generated guide, or null when none exists yet. */
	guide: PrReviewGuide | null;
	/** True while a generation is in flight (the button's pending state). */
	isGenerating: boolean;
	/** True while the cache is still being read (gates empty-vs-loading copy). */
	isLoadingCached: boolean;
	/**
	 * Whether the cached guide is stale vs the PR's current head SHA (M6) — i.e.
	 * new commits landed since this guide was generated. Drives the
	 * "stale — Regenerate" affordance. Never triggers anything on its own.
	 */
	isStale: boolean;
	/** Trigger generation. The ONLY way a guide is ever produced (plan A2). */
	generate: () => void;
}

/**
 * Owns the Guide tab's data + generate flow (Wave 5, M5).
 *
 * Read path (cache-first, AGENTS.md #9): `prReview.getCachedGuide` is a QUERY
 * that GENERATES NOTHING — it only returns what a prior button press persisted
 * (`{ guide, stale } | null`). On open/view we render the cached guide (or the
 * empty state when null) immediately from `data`; `isLoadingCached` only chooses
 * the empty-vs-loading copy.
 *
 * Write path (button-only): `prReview.generateGuide` is a MUTATION — the host
 * made it a mutation precisely so queries (open/view/tab-switch) can't reach it.
 * `generate` is the sole caller and is invoked ONLY from the button's onClick
 * (never from an effect / onMount), so generation stays explicit. On success we
 * invalidate `getCachedGuide` so the freshly-persisted guide (and its now-fresh
 * `stale:false`) flows back through the read path — one source of truth.
 */
export function useGenerateGuide({
	projectId,
	prNumber,
}: UseGenerateGuideArgs): UseGenerateGuideResult {
	const utils = workspaceTrpc.useUtils();

	const cachedQuery = workspaceTrpc.prReview.getCachedGuide.useQuery(
		{ projectId, prNumber },
		// The cache is read-only and changes only on an explicit (re)generate, so
		// it never needs background refetching.
		{ staleTime: Number.POSITIVE_INFINITY },
	);

	const generateMutation = workspaceTrpc.prReview.generateGuide.useMutation({
		onSuccess: () => {
			// Re-read the cache so the persisted guide + fresh staleness render via
			// the single read path (rather than mirroring the mutation result into
			// local state).
			void utils.prReview.getCachedGuide.invalidate({ projectId, prNumber });
		},
		onError: (error) => {
			toast.error("Couldn't generate the review guide", {
				description: error.message,
			});
		},
	});

	const generate = useCallback(() => {
		// Sole trigger. Called only from the Generate / Regenerate button onClick.
		generateMutation.mutate({ projectId, prNumber });
	}, [generateMutation, projectId, prNumber]);

	const cached = cachedQuery.data ?? null;

	return {
		guide: cached?.guide ?? null,
		isGenerating: generateMutation.isPending,
		isLoadingCached: cachedQuery.isLoading,
		isStale: cached?.stale ?? false,
		generate,
	};
}
