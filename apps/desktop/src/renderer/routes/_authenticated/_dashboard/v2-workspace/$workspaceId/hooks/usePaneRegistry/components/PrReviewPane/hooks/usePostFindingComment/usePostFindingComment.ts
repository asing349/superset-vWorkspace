import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useState } from "react";
import type { Finding } from "../../types";
import type { PrTarget } from "../../utils/parsePrTarget";

export interface UsePostFindingCommentArgs {
	projectId: string;
	prNumber: number;
	/** The PR's GitHub coordinates (parsed from its URL); null when unresolved. */
	target: PrTarget | null;
	/** The reviewed head SHA — the comment's commit anchor; null when no report. */
	commitId: string | null;
}

export interface UsePostFindingCommentResult {
	/**
	 * Post ONE finding to the PR as a review comment. This is the sole trigger,
	 * called only from a per-finding "Post comment" click — never autonomously,
	 * never in bulk (Assumption A4). On success it flips THAT finding to `posted`.
	 */
	postFinding: (finding: Finding) => void;
	/** The id of the finding currently being posted (drives its pending state). */
	postingFindingId: string | null;
	/** Whether posting is currently possible (PR coordinates + commit resolved). */
	canPost: boolean;
}

/**
 * Owns the M3 per-finding comment-post flow. An explicit click runs a two-step
 * write, both gated on a real user action:
 *  1. `github.createReviewComment` — the ONE new GitHub write surface (redacts
 *     the body host-side); inline on the diff when the finding carries a NEW-side
 *     line, else a top-level PR review comment.
 *  2. `prReview.markFindingPosted` — flips the finding's `state` to `posted` in
 *     the persisted findings blob, then invalidates `getCachedFindings` so the
 *     UI re-reads the now-`posted` finding (single source of truth, mirroring
 *     `useReviewPr`).
 *
 * Posting is disabled (`canPost === false`) until the PR's coordinates + reviewed
 * commit are known, so a click never fires a malformed write.
 */
export function usePostFindingComment({
	projectId,
	prNumber,
	target,
	commitId,
}: UsePostFindingCommentArgs): UsePostFindingCommentResult {
	const utils = workspaceTrpc.useUtils();
	const [postingFindingId, setPostingFindingId] = useState<string | null>(null);

	const postComment = workspaceTrpc.github.createReviewComment.useMutation();
	const markPosted = workspaceTrpc.prReview.markFindingPosted.useMutation();

	const canPost = Boolean(target && commitId);

	const postFinding = useCallback(
		(finding: Finding) => {
			if (!target || !commitId) {
				toast.error("Can't post this comment", {
					description: "The PR's GitHub location couldn't be resolved.",
				});
				return;
			}

			setPostingFindingId(finding.id);

			// Inline only when the finding carries a usable NEW-side file + line
			// (M1's anti-hallucination guard guarantees both are real); otherwise the
			// host posts a top-level review comment.
			const hasLine =
				Boolean(finding.anchor.file) && typeof finding.anchor.line === "number";

			postComment.mutate(
				{
					owner: target.owner,
					repo: target.repo,
					pullNumber: prNumber,
					commitId,
					body: `${finding.text}\n\n${finding.rationale}`,
					path: hasLine ? finding.anchor.file : undefined,
					line: hasLine ? finding.anchor.line : undefined,
				},
				{
					onSuccess: (result) => {
						toast.success("Comment posted", { description: result.htmlUrl });
						// Persist the state flip, then re-read the cache so the finding
						// renders as `posted`.
						markPosted.mutate(
							{ projectId, prNumber, findingId: finding.id },
							{
								onSuccess: () => {
									void utils.prReview.getCachedFindings.invalidate({
										projectId,
										prNumber,
									});
								},
								onSettled: () => setPostingFindingId(null),
							},
						);
					},
					onError: (error) => {
						setPostingFindingId(null);
						toast.error("Couldn't post comment", {
							description: error.message,
						});
					},
				},
			);
		},
		[target, commitId, prNumber, projectId, postComment, markPosted, utils],
	);

	return { postFinding, postingFindingId, canPost };
}
