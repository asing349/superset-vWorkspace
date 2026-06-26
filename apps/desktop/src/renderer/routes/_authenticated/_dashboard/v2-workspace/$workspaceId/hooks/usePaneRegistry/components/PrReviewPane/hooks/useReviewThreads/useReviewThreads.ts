import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo, useState } from "react";
import type { ReviewThread } from "../../types";
import { orderReviewThreads } from "../../utils/orderReviewThreads";
import type { PrTarget } from "../../utils/parsePrTarget";

export interface UseReviewThreadsArgs {
	/** The PR's GitHub coordinates (parsed from its URL); null when unresolved. */
	target: PrTarget | null;
	prNumber: number;
}

export interface UseReviewThreadsResult {
	/** Existing review threads, ordered actionable-first; empty until loaded. */
	threads: ReviewThread[];
	/** True while the threads read is in flight (gates empty-vs-loading copy). */
	isLoading: boolean;
	/** True when the PR's coordinates couldn't be resolved (read disabled). */
	isUnavailable: boolean;
	/**
	 * Toggle a thread's resolved state on GitHub (Wave 6, M4). Explicit click
	 * only — there is no bulk resolve. On success the threads list is re-read so
	 * the toggled thread reflects its new state.
	 */
	toggleResolved: (args: { threadId: string; resolved: boolean }) => void;
	/** The id of the thread whose resolution is currently being toggled. */
	togglingThreadId: string | null;
}

/**
 * Owns the Threads tab's data + resolve flow (Wave 6, M4). Reads existing GitHub
 * review threads for an ARBITRARY PR via the generalised
 * `git.getPullRequestThreads({ owner, name, prNumber })`, and toggles a thread's
 * resolution via `git.setReviewThreadResolution({ threadId, resolved })` (no
 * workspace needed — the GraphQL mutation keys on the global thread node id).
 *
 * The read is enabled only once the PR's coordinates resolve, so a non-GitHub /
 * still-loading row never fires a malformed query.
 */
export function useReviewThreads({
	target,
	prNumber,
}: UseReviewThreadsArgs): UseReviewThreadsResult {
	const utils = workspaceTrpc.useUtils();
	const [togglingThreadId, setTogglingThreadId] = useState<string | null>(null);

	const threadsQuery = workspaceTrpc.git.getPullRequestThreads.useQuery(
		target
			? { owner: target.owner, name: target.repo, prNumber }
			: // Placeholder input; the query is disabled until `target` resolves, so
				// this is never sent.
				{ owner: "", name: "", prNumber },
		{ enabled: Boolean(target), staleTime: 30_000 },
	);

	const setResolution =
		workspaceTrpc.git.setReviewThreadResolution.useMutation();

	const threads = useMemo(
		() => orderReviewThreads(threadsQuery.data?.reviewThreads ?? []),
		[threadsQuery.data],
	);

	const toggleResolved = useCallback(
		({ threadId, resolved }: { threadId: string; resolved: boolean }) => {
			if (!target) return;
			setTogglingThreadId(threadId);
			setResolution.mutate(
				{ threadId, resolved },
				{
					onSuccess: () => {
						void utils.git.getPullRequestThreads.invalidate({
							owner: target.owner,
							name: target.repo,
							prNumber,
						});
					},
					onError: (error) => {
						toast.error("Couldn't update thread", {
							description: error.message,
						});
					},
					onSettled: () => setTogglingThreadId(null),
				},
			);
		},
		[target, prNumber, setResolution, utils],
	);

	return {
		threads,
		isLoading: threadsQuery.isLoading && Boolean(target),
		isUnavailable: !target,
		toggleResolved,
		togglingThreadId,
	};
}
