import type { PrReviewPaneData } from "../../../../types";

/**
 * Find an already-open PR-review pane for a specific PR across a workspace's
 * tabs (PURE LOGIC). Mirrors `findMemoryPane`, but the review window is
 * single-instance PER PR (keyed by `prNumber`) rather than per workspace — so
 * opening PR #12 twice focuses the existing #12 window, while #13 opens its
 * own. Extracted from `openPrReviewPane` so the "reuse vs add a new tab"
 * decision is unit-testable without standing up the panes store. Returns the
 * tab id + pane id to focus, or null when no window for that PR is open.
 */
export function findPrReviewPane(
	tabs: ReadonlyArray<{
		id: string;
		panes: Record<string, { id: string; kind: string; data: unknown }>;
	}>,
	prNumber: number,
): { tabId: string; paneId: string } | null {
	for (const tab of tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.kind !== "pr-review") continue;
			const data = pane.data as PrReviewPaneData;
			if (data.prNumber === prNumber) {
				return { tabId: tab.id, paneId: pane.id };
			}
		}
	}
	return null;
}
