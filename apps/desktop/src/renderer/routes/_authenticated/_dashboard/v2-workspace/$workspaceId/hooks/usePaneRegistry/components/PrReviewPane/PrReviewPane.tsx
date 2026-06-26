import type { RendererContext } from "@superset/panes";
import { useCallback, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { PaneViewerData, PrReviewPaneData } from "../../../../types";
import { FindingsTab } from "./components/FindingsTab";
import { GuideTab } from "./components/GuideTab";
import { PrDiffView } from "./components/PrDiffView";
import { PrReviewHeader } from "./components/PrReviewHeader";
import { ThreadsTab } from "./components/ThreadsTab";
import { useGenerateGuide } from "./hooks/useGenerateGuide";
import { useReviewPr } from "./hooks/useReviewPr";
import { useReviewThreads } from "./hooks/useReviewThreads";
import type { GuideAnchor } from "./types";
import { parsePrTarget } from "./utils/parsePrTarget";
import { type PrReviewSection, resolvePrReviewSection } from "./utils/sections";

interface PrReviewPaneProps {
	context: RendererContext<PaneViewerData>;
	/** v2 project the PR belongs to (`workspace.projectId`). */
	projectId: string;
}

/**
 * The PR review window (Wave 5, M2/M5). One pane per PR with a Diff | Guide
 * segmented control — the wave-3 Memory pane (`MemoryPane`) is the precedent:
 * the active section lives in the pane's own data (`PrReviewPaneData.section`),
 * so it survives tab switches and restores with the workspace.
 *
 * - Diff tab: the PR's `base..head` multi-file diff, fed by the host
 *   `prReview.getDiff` and rendered with the shared `@pierre/diffs` primitives
 *   (`PrDiffView`). M5 scrolls it to a guide anchor's file/line.
 * - Guide tab: the cached guide (read via `getCachedGuide`) or an empty state
 *   with a "Generate guide" button (the ONLY trigger; never auto-runs). Clicking
 *   a code-anchored claim (M5) switches to the Diff tab and scrolls there.
 */
export function PrReviewPane({ context, projectId }: PrReviewPaneProps) {
	const data = context.pane.data as PrReviewPaneData;
	const { prNumber } = data;
	const section = resolvePrReviewSection(data.section);
	const updateData = context.actions.updateData;

	const setSection = useCallback(
		(next: PrReviewSection) => {
			updateData({ ...data, section: next });
		},
		[data, updateData],
	);

	// Anchor click-through: a Guide claim OR a wave-6 Finding → jump to the code.
	// Switch to the Diff tab and stamp the scroll target (`focusFile`/`focusLine`),
	// bumping `focusTick` so a repeat click of the same anchor re-scrolls (the
	// wave-3 A3 pattern). Guide and Finding anchors share the same
	// `{ file, line?, symbol? }` shape, so one handler serves both. A symbol-only
	// anchor still carries a host-resolved `file`, so it routes the same way;
	// `href` anchors (PR/playbook links) are opened inline and never reach here.
	// The scroll keeps the user in the review window rather than yanking focus to
	// a separate editor pane.
	const handleOpenAnchor = useCallback(
		(anchor: GuideAnchor) => {
			if (!anchor.file) return;
			updateData({
				...data,
				section: "diff",
				focusFile: anchor.file,
				focusLine: anchor.line,
				focusTick: Date.now(),
			});
		},
		[data, updateData],
	);

	// Best-effort PR metadata for the header (title + GitHub link). The list this
	// PR was opened from is the same source; cache-first so the header fills in
	// without blocking the diff. A failure just leaves the "#N" fallback title.
	const prListUtils = electronTrpc.useUtils();
	const prListQuery = electronTrpc.projects.listPullRequests.useQuery(
		{ projectId, includeClosed: true },
		{ staleTime: 60_000, enabled: Boolean(projectId) },
	);
	const prRow = (prListQuery.data ?? []).find((pr) => pr.prNumber === prNumber);

	// GitHub coordinates for the M3 "Post comment" + M4 merge/threads actions,
	// derived from the PR's html URL (the same row the header links to). Null until
	// the row loads or for a non-GitHub URL — the dependent actions then disable.
	const prTarget = useMemo(() => parsePrTarget(prRow?.url), [prRow?.url]);

	// Merge is only offered while the PR is open (M4). The PR list row's `state`
	// ("open" | "draft" | "merged" | "closed") is GitHub's already-merged/closed
	// guard at the UI layer; `octokit.pulls.merge` is the authoritative one.
	const canMerge = prRow?.state === "open";

	// Re-read the PR list after a merge so the row's `state` flips (the merge
	// button then hides) — the M4 post-merge refresh, mirroring PRStatusGroup.
	const handleMerged = useCallback(() => {
		void prListUtils.projects.listPullRequests.invalidate({ projectId });
	}, [prListUtils, projectId]);

	const guideState = useGenerateGuide({ projectId, prNumber });
	// Cache-first read of any prior review (button-only mutation lives inside).
	// Mounting/reading NEVER reviews — only the Findings tab's button does.
	const reviewState = useReviewPr({ projectId, prNumber });
	// Existing GitHub review threads for THIS PR (M4), keyed by parsed owner/repo +
	// number — reads are gated on `prTarget`, resolution is an explicit click.
	const threadsState = useReviewThreads({ target: prTarget, prNumber });

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-background">
			<PrReviewHeader
				prNumber={prNumber}
				title={prRow?.title}
				url={prRow?.url}
				mergeTarget={prTarget}
				canMerge={canMerge}
				onMerged={handleMerged}
				activeSection={section}
				onSelectSection={setSection}
			/>
			<div className="min-h-0 flex-1">
				{section === "diff" ? (
					<PrDiffView
						projectId={projectId}
						prNumber={prNumber}
						focusFile={data.focusFile}
						focusLine={data.focusLine}
						focusTick={data.focusTick}
					/>
				) : section === "findings" ? (
					<FindingsTab
						reviewState={reviewState}
						projectId={projectId}
						prNumber={prNumber}
						commentTarget={prTarget}
						onOpenAnchor={handleOpenAnchor}
					/>
				) : section === "threads" ? (
					<ThreadsTab threadsState={threadsState} />
				) : (
					<GuideTab guideState={guideState} onOpenAnchor={handleOpenAnchor} />
				)}
			</div>
		</div>
	);
}
