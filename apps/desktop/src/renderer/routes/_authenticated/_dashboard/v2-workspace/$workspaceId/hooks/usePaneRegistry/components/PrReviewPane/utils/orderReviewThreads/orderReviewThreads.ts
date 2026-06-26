/**
 * Order a PR's review threads for the Threads tab (Wave 6, M4): actionable items
 * first. Unresolved threads sort ahead of resolved ones; within the same
 * resolution state, current (non-outdated) threads sort ahead of outdated ones.
 * The sort is STABLE within a bucket, so GitHub's own thread order is preserved
 * inside each group.
 *
 * PURE + browser-safe (no Node imports) and generic over the minimal shape, so it
 * unit-tests without the full router output type.
 */
export interface OrderableReviewThread {
	isResolved: boolean;
	isOutdated: boolean;
}

/** Lower rank renders first. */
function threadRank(thread: OrderableReviewThread): number {
	if (!thread.isResolved && !thread.isOutdated) return 0;
	if (!thread.isResolved && thread.isOutdated) return 1;
	if (thread.isResolved && !thread.isOutdated) return 2;
	return 3;
}

export function orderReviewThreads<T extends OrderableReviewThread>(
	threads: readonly T[],
): T[] {
	return threads
		.map((thread, index) => ({ thread, index }))
		.sort((a, b) => {
			const rankDelta = threadRank(a.thread) - threadRank(b.thread);
			// Fall back to the original index to keep the sort stable within a bucket.
			return rankDelta !== 0 ? rankDelta : a.index - b.index;
		})
		.map((entry) => entry.thread);
}
