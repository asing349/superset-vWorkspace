import type { WorkspaceStore } from "@superset/panes";
import { useCallback, useMemo } from "react";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { StoreApi } from "zustand/vanilla";
import type {
	FilePaneData,
	PaneViewerData,
} from "../../../../v2-workspace/$workspaceId/types";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

/**
 * File navigation for the multi-root workspace ("group") shell.
 *
 * Mirrors the single-workspace `useWorkspaceFileNavigation` open/dedup logic but
 * resolves the absolute path against the *clicked root's* `rootPath` (each root
 * has its own root directory) and always stamps the pane with that root's
 * `rootId`. The `rootId` is what threads `{ groupId, rootId }` filesystem
 * routing through the pane registry / shared document store. De-dup/focus
 * matches on absolute `filePath` AND `rootId`, so the same relative path under
 * two different roots opens as two distinct panes.
 *
 * M4 wires the group Files explorer to call `openFilePane({ filePath, rootId })`
 * per clicked root; M3 provides the hook so the seam (rootId → reads) is final.
 */
export function useGroupFileNavigation({
	store,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): {
	openFilePane: (input: {
		filePath: string;
		rootId: string;
		openInNewTab?: boolean;
		/** 1-based line to focus on open (A3). */
		focusLine?: number;
		/** 1-based column paired with `focusLine`. */
		focusColumn?: number;
	}) => void;
} {
	const { roots } = useWorkspaceGroup();

	const rootPathById = useMemo(() => {
		const map = new Map<string, string>();
		for (const root of roots) {
			map.set(root.rootId, root.rootPath);
		}
		return map;
	}, [roots]);

	const openFilePane = useCallback(
		(input: {
			filePath: string;
			rootId: string;
			openInNewTab?: boolean;
			focusLine?: number;
			focusColumn?: number;
		}) => {
			const { filePath, rootId, openInNewTab, focusLine, focusColumn } = input;
			const rootPath = rootPathById.get(rootId) ?? "";
			const absoluteFilePath = rootPath
				? toAbsoluteWorkspacePath(rootPath, filePath)
				: filePath;

			// A new focusTick each open makes the editor re-scroll even when the
			// same file+line is re-selected (the focus effect keys off focusTick).
			const focusFields: Pick<
				FilePaneData,
				"focusLine" | "focusColumn" | "focusTick"
			> =
				focusLine !== undefined
					? { focusLine, focusColumn, focusTick: Date.now() }
					: {};

			const fileData: FilePaneData = {
				filePath: absoluteFilePath,
				mode: "editor",
				rootId,
				...focusFields,
			};
			const state = store.getState();

			if (openInNewTab) {
				state.addTab({ panes: [{ kind: "file", data: fileData }] });
				return;
			}

			// Focus an existing pane for this file+root before opening a new one.
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (
						pane.kind === "file" &&
						(pane.data as FilePaneData).filePath === absoluteFilePath &&
						(pane.data as FilePaneData).rootId === rootId
					) {
						// Re-focus the requested line in the already-open pane by bumping
						// its focus fields (a fresh focusTick re-triggers the scroll).
						if (focusLine !== undefined) {
							state.setPaneData({
								paneId: pane.id,
								data: {
									...(pane.data as FilePaneData),
									...focusFields,
								} as PaneViewerData,
							});
						}
						state.setActiveTab(tab.id);
						state.setActivePane({ tabId: tab.id, paneId: pane.id });
						return;
					}
				}
			}

			state.openPane({ pane: { kind: "file", data: fileData } });
		},
		[rootPathById, store],
	);

	return { openFilePane };
}
