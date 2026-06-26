import { Button } from "@superset/ui/button";
import { LuRefreshCw, LuShieldCheck } from "react-icons/lu";
import { usePostFindingComment } from "../../hooks/usePostFindingComment";
import type { UseReviewPrResult } from "../../hooks/useReviewPr";
import type { FindingAnchor } from "../../types";
import type { PrTarget } from "../../utils/parsePrTarget";
import { FindingsSectionView } from "../FindingsSectionView";

interface FindingsTabProps {
	reviewState: UseReviewPrResult;
	projectId: string;
	prNumber: number;
	/** The PR's GitHub coordinates (owner/repo) for posting comments; M3. */
	commentTarget: PrTarget | null;
	/** Jump a finding's anchor to the sibling Diff tab (M1). */
	onOpenAnchor?: (anchor: FindingAnchor) => void;
}

/**
 * The Findings tab of the PR-review window (Wave 6, M1).
 *
 * Cache-first: findings are read via `prReview.getCachedFindings` (read-only — it
 * reviews nothing). When the cache is null this is an EMPTY STATE with a single
 * "Review PR" button — the ONLY thing that ever triggers a review (button-only:
 * never on open, view, tab-switch, or new commits). When a report exists it
 * renders the findings grouped by severity; a "Re-review" button shows ONLY when
 * the cached findings are stale vs the PR's head SHA and is never auto-run.
 * Clicking a finding calls `onOpenAnchor` → the Diff tab scrolls to the file/line.
 */
export function FindingsTab({
	reviewState,
	projectId,
	prNumber,
	commentTarget,
	onOpenAnchor,
}: FindingsTabProps) {
	const { report, isReviewing, isLoadingCached, isStale, review } = reviewState;

	// The M3 per-finding comment-post flow. The commit anchor is the SHA the
	// findings were reviewed against (`report.headSha`), so an inline comment
	// lands on the exact code the finding describes. Hook is called
	// unconditionally (rules of hooks); it stays disabled until a report + target
	// are resolved.
	const { postFinding, postingFindingId, canPost } = usePostFindingComment({
		projectId,
		prNumber,
		target: commentTarget,
		commitId: report?.headSha ?? null,
	});

	if (!report) {
		// Cache-first (#9): while the read is still in flight, show a neutral
		// loading line rather than flashing the "no review" CTA.
		if (isLoadingCached) {
			return (
				<div className="flex h-full w-full cursor-text select-text items-center justify-center text-sm text-muted-foreground">
					Loading findings…
				</div>
			);
		}
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
				<LuShieldCheck className="size-8 text-muted-foreground" />
				<div className="max-w-sm space-y-1">
					<p className="text-sm font-medium text-foreground">No review yet</p>
					<p className="cursor-text select-text text-xs text-muted-foreground">
						Run a grounded review of this PR — structured findings with a
						severity and category, each anchored to a file and line in the diff.
						It runs only when you ask, on your local AI session.
					</p>
				</div>
				<Button size="sm" onClick={review} disabled={isReviewing}>
					<LuShieldCheck className="size-4" />
					{isReviewing ? "Reviewing…" : "Review PR"}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				{report.baselineOnly ? (
					<span className="cursor-text select-text rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						deterministic only
					</span>
				) : null}
				{isStale ? (
					<>
						<span className="cursor-text select-text text-xs text-amber-600">
							Stale — new commits since this review
						</span>
						<Button
							size="xs"
							variant="secondary"
							className="ml-auto"
							onClick={review}
							disabled={isReviewing}
						>
							<LuRefreshCw className="size-3.5" />
							{isReviewing ? "Re-reviewing…" : "Re-review"}
						</Button>
					</>
				) : (
					<Button
						size="xs"
						variant="secondary"
						className="ml-auto"
						onClick={review}
						disabled={isReviewing}
					>
						<LuRefreshCw className="size-3.5" />
						{isReviewing ? "Re-reviewing…" : "Re-review"}
					</Button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{report.findings.length > 0 ? (
					<FindingsSectionView
						findings={report.findings}
						onOpenAnchor={onOpenAnchor}
						onPostComment={postFinding}
						postingFindingId={postingFindingId}
						canPost={canPost}
					/>
				) : (
					<div className="flex h-full w-full cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
						No issues found in this PR.
					</div>
				)}
			</div>
		</div>
	);
}
