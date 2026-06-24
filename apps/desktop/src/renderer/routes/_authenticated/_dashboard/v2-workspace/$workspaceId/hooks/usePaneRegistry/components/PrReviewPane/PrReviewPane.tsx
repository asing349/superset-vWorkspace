import type { RendererContext } from "@superset/panes";
import { useCallback } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { PaneViewerData, PrReviewPaneData } from "../../../../types";
import { GuideTab } from "./components/GuideTab";
import { PrDiffView } from "./components/PrDiffView";
import { PrReviewHeader } from "./components/PrReviewHeader";
import { useGenerateGuide } from "./hooks/useGenerateGuide";
import type { GuideAnchor } from "./types";
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

	// M5 anchor click-through: a Guide claim → jump to the code. Switch to the
	// Diff tab and stamp the scroll target (`focusFile`/`focusLine`), bumping
	// `focusTick` so a repeat click of the same anchor re-scrolls (the wave-3 A3
	// pattern). A symbol-only anchor still carries a host-resolved `file` ("where
	// X lives"), so it routes the same way; `href` anchors (PR/playbook links) are
	// opened inline by the link rendering and never reach here. The scroll keeps
	// the user in the review window (the differentiator) rather than yanking focus
	// to a separate editor pane.
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
	const prListQuery = electronTrpc.projects.listPullRequests.useQuery(
		{ projectId, includeClosed: true },
		{ staleTime: 60_000, enabled: Boolean(projectId) },
	);
	const prRow = (prListQuery.data ?? []).find((pr) => pr.prNumber === prNumber);

	const guideState = useGenerateGuide({ projectId, prNumber });

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-background">
			<PrReviewHeader
				prNumber={prNumber}
				title={prRow?.title}
				url={prRow?.url}
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
				) : (
					<GuideTab guideState={guideState} onOpenAnchor={handleOpenAnchor} />
				)}
			</div>
		</div>
	);
}
