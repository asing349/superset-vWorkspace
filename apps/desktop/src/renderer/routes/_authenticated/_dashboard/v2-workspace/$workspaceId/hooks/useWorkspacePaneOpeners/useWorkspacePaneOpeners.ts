import type { WorkspaceStore } from "@superset/panes";
import { useCallback } from "react";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import type { StoreApi } from "zustand/vanilla";
import type {
	BrowserPaneData,
	ChatPaneData,
	CommentPaneData,
	DiffFocusSide,
	DiffPaneData,
	MemoryPaneData,
	PaneViewerData,
	TerminalPaneData,
} from "../../types";
import type { TerminalLauncher } from "../useV2TerminalLauncher";
import { findMemoryPane } from "./utils/findMemoryPane";

export function useWorkspacePaneOpeners({
	store,
	launcher,
	newTabPresets,
	executePreset,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	launcher: TerminalLauncher;
	newTabPresets: V2TerminalPresetRow[];
	executePreset: (
		preset: V2TerminalPresetRow,
		options?: { target?: "new-tab" | "active-tab" },
	) => void | Promise<void>;
}): {
	openDiffPane: (
		filePath: string,
		openInNewTab?: boolean,
		line?: number,
		side?: DiffFocusSide,
	) => void;
	addTerminalTab: () => Promise<void>;
	addChatTab: () => void;
	addBrowserTab: () => void;
	openCommentPane: (comment: CommentPaneData) => void;
	openMemoryPane: () => void;
} {
	const openDiffPane = useCallback(
		(
			filePath: string,
			openInNewTab?: boolean,
			line?: number,
			side?: DiffFocusSide,
		) => {
			const state = store.getState();
			// Bump tick on every request so the scroll effect re-fires on repeat
			// clicks; clear when no line is given so reused panes don't jump
			// to a stale focus.
			const focusFields =
				line != null
					? { focusLine: line, focusSide: side, focusTick: Date.now() }
					: {
							focusLine: undefined,
							focusSide: undefined,
							focusTick: undefined,
						};
			if (openInNewTab) {
				state.addTab({
					panes: [
						{
							kind: "diff",
							data: {
								path: filePath,
								collapsedFiles: [],
								...focusFields,
							} as DiffPaneData,
						},
					],
				});
				return;
			}
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (pane.kind !== "diff") continue;
					const prev = pane.data as DiffPaneData;
					state.setPaneData({
						paneId: pane.id,
						data: {
							...prev,
							path: filePath,
							collapsedFiles: (prev.collapsedFiles ?? []).filter(
								(p) => p !== filePath,
							),
							...focusFields,
						} as PaneViewerData,
					});
					state.setActiveTab(tab.id);
					state.setActivePane({ tabId: tab.id, paneId: pane.id });
					return;
				}
			}
			state.openPane({
				pane: {
					kind: "diff",
					data: {
						path: filePath,
						collapsedFiles: [],
						...focusFields,
					} as DiffPaneData,
				},
			});
		},
		[store],
	);

	const addBlankTerminalTab = useCallback(async () => {
		const terminalId = await launcher.create();
		store.getState().addTab({
			panes: [
				{
					kind: "terminal",
					data: { terminalId } as TerminalPaneData,
				},
			],
		});
	}, [store, launcher]);

	const addTerminalTab = useCallback(async () => {
		if (newTabPresets.length === 0) {
			await addBlankTerminalTab();
			return;
		}

		// New terminal tabs are the trigger point for applyOnNewTab presets.
		// Each matching preset owns the tab/pane shape it creates.
		for (const preset of newTabPresets) {
			await executePreset(preset, { target: "new-tab" });
		}
	}, [addBlankTerminalTab, executePreset, newTabPresets]);

	const addChatTab = useCallback(() => {
		store.getState().addTab({
			panes: [
				{
					kind: "chat",
					data: { sessionId: null } as ChatPaneData,
				},
			],
		});
	}, [store]);

	const addBrowserTab = useCallback(() => {
		store.getState().addTab({
			panes: [
				{
					kind: "browser",
					data: {
						url: "about:blank",
					} as BrowserPaneData,
				},
			],
		});
	}, [store]);

	const openCommentPane = useCallback(
		(comment: CommentPaneData) => {
			const state = store.getState();
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (pane.kind !== "comment") continue;
					state.setPaneData({
						paneId: pane.id,
						data: comment as PaneViewerData,
					});
					state.setActiveTab(tab.id);
					state.setActivePane({ tabId: tab.id, paneId: pane.id });
					return;
				}
			}
			state.addTab({
				panes: [
					{
						kind: "comment",
						data: comment as PaneViewerData,
					},
				],
			});
		},
		[store],
	);

	const openMemoryPane = useCallback(() => {
		const state = store.getState();
		// Single Memory pane per workspace: focus the existing one if open,
		// otherwise add a fresh tab. The panel is the long-lived home for B5/B6/B7.
		const existing = findMemoryPane(state.tabs);
		if (existing) {
			state.setActiveTab(existing.tabId);
			state.setActivePane(existing);
			return;
		}
		state.addTab({
			panes: [
				{
					kind: "memory",
					data: { section: "playbooks" } as MemoryPaneData,
				},
			],
		});
	}, [store]);

	return {
		openDiffPane,
		addTerminalTab,
		addChatTab,
		addBrowserTab,
		openCommentPane,
		openMemoryPane,
	};
}
