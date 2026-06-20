import { Workspace } from "@superset/panes";
import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { BsTerminalPlus } from "react-icons/bs";
import { useHotkey } from "renderer/hotkeys";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import { useStore } from "zustand";
import type {
	FilePaneData,
	PaneViewerData,
} from "../../v2-workspace/$workspaceId/types";
import { CombinedAgentRootsHint } from "./components/CombinedAgentRootsHint";
import { GroupAddTabMenu } from "./components/GroupAddTabMenu";
import { GroupEmptyState } from "./components/GroupEmptyState";
import { GroupManageButton } from "./components/GroupManageButton";
import { GroupQuickOpen } from "./components/GroupQuickOpen";
import { GroupSidebar } from "./components/GroupSidebar";
import { useCombinedAgentRoots } from "./hooks/useCombinedAgentRoots";
import { useGroupFileNavigation } from "./hooks/useGroupFileNavigation";
import { useGroupPaneLayout } from "./hooks/useGroupPaneLayout";
import { useGroupPaneRegistry } from "./hooks/useGroupPaneRegistry";
import { useGroupTerminalOpeners } from "./hooks/useGroupTerminalOpeners";
import { useWorkspaceGroup } from "./providers/WorkspaceGroupProvider";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-group/$groupId/",
)({
	component: V2GroupPage,
});

function V2GroupPage() {
	const { groupId, group, roots, defaultRoot } = useWorkspaceGroup();
	const { store } = useGroupPaneLayout();
	const { openFilePane } = useGroupFileNavigation({ store });
	const registry = useGroupPaneRegistry({ onOpenFile: openFilePane });
	const { openRootTerminal, openAgentTerminal } = useGroupTerminalOpeners({
		store,
	});
	// M5: the roots the combined agent will see (exists-only, matching
	// prepareAgentRoot) + whether a running agent's view is stale vs current roots.
	const {
		visibleRoots: agentVisibleRoots,
		rootsChangedSinceLaunch: agentRootsChangedSinceLaunch,
		recordLaunchSignature,
	} = useCombinedAgentRoots({ store });
	const [sidebarWidth, setSidebarWidth] = useState(300);
	const [isSidebarResizing, setIsSidebarResizing] = useState(false);
	const [quickOpenOpen, setQuickOpenOpen] = useState(false);

	// Cross-root quick-open (Q4). The handler is scoped to this group page: the
	// `useHotkey("QUICK_OPEN", …)` binding only lives while this component is
	// mounted, and the single-workspace `QUICK_OPEN` binding lives in the
	// v2-workspace page (never mounted on a group route), so this does not hijack
	// or break the global palette outside group routes. An empty group has no
	// roots to search, so quick-open is suppressed there.
	const openQuickOpen = useCallback(() => {
		if (roots.length > 0) setQuickOpenOpen(true);
	}, [roots.length]);
	useHotkey("QUICK_OPEN", openQuickOpen);
	const handleQuickOpenSelect = useCallback(
		(result: { absolutePath: string; rootId: string }) => {
			// The result's path is already absolute; `openFilePane` stores absolute
			// paths verbatim (toAbsoluteWorkspacePath is a no-op on absolute input)
			// and stamps the result's `rootId` so FS reads route to THAT root.
			openFilePane({
				filePath: result.absolutePath,
				rootId: result.rootId,
			});
		},
		[openFilePane],
	);

	// Terminal actions surface in the pane-area "+" menu (and the empty-pane
	// state). Awaited create/launch is fire-and-forget from the click handler;
	// errors are surfaced by the launcher's tRPC client.
	const handleAddRootTerminal = useCallback(
		(rootId: string) => {
			void openRootTerminal(rootId);
		},
		[openRootTerminal],
	);
	const handleLaunchAgent = useCallback(() => {
		// openAgentTerminal always re-runs prepareAgentRoot (idempotent) so the
		// just-launched agent reflects the current roots; record that root set as
		// the baseline so the "changed since launch" nudge starts fresh.
		void openAgentTerminal();
		recordLaunchSignature();
	}, [openAgentTerminal, recordLaunchSignature]);
	const handleOpenDefaultTerminal = useCallback(() => {
		if (defaultRoot) void openRootTerminal(defaultRoot.rootId);
	}, [defaultRoot, openRootTerminal]);

	// Track the active file pane's absolute path so the sidebar can highlight the
	// open file. Mirrors the single-workspace shell's `selectedFilePath`, derived
	// directly off the group store (the M3 `useGroupFileNavigation` seam exposes
	// only `openFilePane`, so the selection is read here).
	const selectedFilePath = useStore(store, (state) => {
		const tab = state.tabs.find(
			(candidate) => candidate.id === state.activeTabId,
		);
		if (!tab?.activePaneId) return undefined;
		const pane = tab.panes[tab.activePaneId];
		if (pane?.kind === "file") return (pane.data as FilePaneData).filePath;
		return undefined;
	});

	// Q5 default: an empty group (zero roots) is allowed and shows an
	// "Add a folder or workspace" prompt rather than an empty editor.
	const isEmptyGroup = roots.length === 0;

	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			{!isEmptyGroup && (
				<ResizablePanel
					width={sidebarWidth}
					onWidthChange={setSidebarWidth}
					isResizing={isSidebarResizing}
					onResizingChange={setIsSidebarResizing}
					minWidth={240}
					maxWidth={640}
					handleSide="right"
					onDoubleClickHandle={() => setSidebarWidth(300)}
				>
					<GroupSidebar
						selectedFilePath={selectedFilePath}
						onSelectFile={({ rootId, filePath, openInNewTab }) =>
							openFilePane({ filePath, rootId, openInNewTab })
						}
						onQuickOpen={openQuickOpen}
					/>
				</ResizablePanel>
			)}
			<div
				className="flex min-h-0 min-w-[320px] flex-1 flex-col overflow-hidden"
				data-group-id={groupId}
			>
				{isEmptyGroup ? (
					<GroupEmptyState
						groupName={group.name}
						action={<GroupManageButton variant="button" />}
					/>
				) : (
					<Workspace<PaneViewerData>
						key={groupId}
						registry={registry}
						store={store}
						renderAddTabMenu={() => (
							<GroupAddTabMenu
								onAddRootTerminal={handleAddRootTerminal}
								onLaunchAgent={handleLaunchAgent}
								agentVisibleRoots={agentVisibleRoots}
								agentRootsChangedSinceLaunch={agentRootsChangedSinceLaunch}
							/>
						)}
						renderEmptyState={() => (
							<div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-sm text-muted-foreground select-text">
								<p>
									Open a file from one of this workspace's roots, or start a
									terminal.
								</p>
								<div className="flex flex-wrap items-center justify-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="gap-1.5"
										disabled={!defaultRoot}
										onClick={handleOpenDefaultTerminal}
									>
										<BsTerminalPlus className="size-4" />
										New Terminal
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleLaunchAgent}
									>
										Launch combined agent
									</Button>
								</div>
								<CombinedAgentRootsHint
									visibleRoots={agentVisibleRoots}
									rootsChangedSinceLaunch={agentRootsChangedSinceLaunch}
									className="items-center text-center"
								/>
							</div>
						)}
					/>
				)}
			</div>
			{!isEmptyGroup && (
				<GroupQuickOpen
					open={quickOpenOpen}
					onOpenChange={setQuickOpenOpen}
					onSelectResult={handleQuickOpenSelect}
				/>
			)}
		</div>
	);
}
