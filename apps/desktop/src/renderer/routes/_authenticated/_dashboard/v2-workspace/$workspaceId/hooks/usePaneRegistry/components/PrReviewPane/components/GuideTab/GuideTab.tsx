import { Button } from "@superset/ui/button";
import { LuRefreshCw, LuSparkles } from "react-icons/lu";
import type { UseGenerateGuideResult } from "../../hooks/useGenerateGuide";
import type { GuideAnchor } from "../../types";
import { GuideSectionView } from "../GuideSectionView";

interface GuideTabProps {
	guideState: UseGenerateGuideResult;
	/** Jump a guide anchor to the sibling Diff tab / editor (M5). */
	onOpenAnchor?: (anchor: GuideAnchor) => void;
}

/**
 * The Guide tab of the PR-review window (Wave 5, M2/M5).
 *
 * Cache-first: the guide is read via `prReview.getCachedGuide` (read-only — it
 * generates nothing). When the cache is null this is an EMPTY STATE with a
 * single "Generate guide" button — the ONLY thing that ever triggers generation
 * (plan A2: never on open, view, or new commits). When a guide exists it renders
 * the sections; a "Regenerate" button shows ONLY when the cached guide is stale
 * vs the PR's head SHA (M6) and is never auto-run. Clicking a code-anchored
 * claim calls `onOpenAnchor` (M5 → scroll the Diff tab / open the editor).
 */
export function GuideTab({ guideState, onOpenAnchor }: GuideTabProps) {
	const { guide, isGenerating, isLoadingCached, isStale, generate } =
		guideState;

	if (!guide) {
		// Cache-first (#9): while the read is still in flight, show a neutral
		// loading line rather than flashing the "no guide" CTA (which could be
		// misread as "nothing was generated").
		if (isLoadingCached) {
			return (
				<div className="flex h-full w-full cursor-text select-text items-center justify-center text-sm text-muted-foreground">
					Loading guide…
				</div>
			);
		}
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
				<LuSparkles className="size-8 text-muted-foreground" />
				<div className="max-w-sm space-y-1">
					<p className="text-sm font-medium text-foreground">
						No review guide yet
					</p>
					<p className="cursor-text select-text text-xs text-muted-foreground">
						Generate a memory-grounded "context of the changes" — what changed,
						what to read first, and where the risk is, each claim anchored to
						the code. It runs only when you ask.
					</p>
				</div>
				<Button size="sm" onClick={generate} disabled={isGenerating}>
					<LuSparkles className="size-4" />
					{isGenerating ? "Generating…" : "Generate guide"}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				{guide.grounded ? null : (
					<span className="cursor-text select-text rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						deterministic only
					</span>
				)}
				{isStale ? (
					<>
						<span className="cursor-text select-text text-xs text-amber-600">
							Stale — new commits since this guide
						</span>
						<Button
							size="xs"
							variant="secondary"
							className="ml-auto"
							onClick={generate}
							disabled={isGenerating}
						>
							<LuRefreshCw className="size-3.5" />
							{isGenerating ? "Regenerating…" : "Regenerate"}
						</Button>
					</>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<GuideSectionView guide={guide} onOpenAnchor={onOpenAnchor} />
			</div>
		</div>
	);
}
