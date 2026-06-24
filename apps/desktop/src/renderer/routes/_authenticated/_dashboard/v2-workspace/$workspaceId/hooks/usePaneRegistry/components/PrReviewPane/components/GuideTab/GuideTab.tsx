import { Button } from "@superset/ui/button";
import { LuRefreshCw, LuSparkles } from "react-icons/lu";
import type { UseGenerateGuideResult } from "../../hooks/useGenerateGuide";
import { GuideSectionView } from "../GuideSectionView";

interface GuideTabProps {
	guideState: UseGenerateGuideResult;
	/** Open the editor / scroll the Diff tab from a guide anchor (M5 wires this). */
	onOpenAnchor?: (anchor: {
		file: string;
		line?: number;
		symbol?: string;
	}) => void;
}

/**
 * The Guide tab of the PR-review window (Wave 5, M2).
 *
 * When no guide exists (the M2 state, and any PR before its first generation),
 * this is an EMPTY STATE with a single "Generate guide" button — the ONLY thing
 * that ever triggers generation (plan A2: never on open, view, or new commits).
 * Once a guide exists (M4+), it renders the sections; a "Regenerate" button is
 * shown ONLY when the cached guide is stale vs the PR's head SHA (M6) — it is
 * never auto-run.
 */
export function GuideTab({ guideState, onOpenAnchor }: GuideTabProps) {
	const { guide, isGenerating, isStale, generate } = guideState;

	if (!guide) {
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
