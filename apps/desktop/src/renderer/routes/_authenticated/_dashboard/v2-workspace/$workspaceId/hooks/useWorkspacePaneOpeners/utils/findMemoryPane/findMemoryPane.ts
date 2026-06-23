/**
 * Find an already-open Memory pane across a workspace's tabs (PURE LOGIC).
 * Extracted from `openMemoryPane` so the "reuse the existing pane vs add a new
 * tab" decision is unit-testable without standing up the panes store. Returns
 * the tab id + pane id to focus, or null when no Memory pane is open.
 */
export function findMemoryPane(
	tabs: ReadonlyArray<{
		id: string;
		panes: Record<string, { id: string; kind: string }>;
	}>,
): { tabId: string; paneId: string } | null {
	for (const tab of tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.kind === "memory") {
				return { tabId: tab.id, paneId: pane.id };
			}
		}
	}
	return null;
}
