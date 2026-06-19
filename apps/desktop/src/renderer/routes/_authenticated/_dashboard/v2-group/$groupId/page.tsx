import { Workspace } from "@superset/panes";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import { useStore } from "zustand";
import type {
	FilePaneData,
	PaneViewerData,
} from "../../v2-workspace/$workspaceId/types";
import { GroupEmptyState } from "./components/GroupEmptyState";
import { GroupManageButton } from "./components/GroupManageButton";
import { GroupSidebar } from "./components/GroupSidebar";
import { useGroupFileNavigation } from "./hooks/useGroupFileNavigation";
import { useGroupPaneLayout } from "./hooks/useGroupPaneLayout";
import { useGroupPaneRegistry } from "./hooks/useGroupPaneRegistry";
import { useWorkspaceGroup } from "./providers/WorkspaceGroupProvider";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-group/$groupId/",
)({
	component: V2GroupPage,
});

function V2GroupPage() {
	const { groupId, group, roots } = useWorkspaceGroup();
	const { store } = useGroupPaneLayout();
	const registry = useGroupPaneRegistry();
	const { openFilePane } = useGroupFileNavigation({ store });
	const [sidebarWidth, setSidebarWidth] = useState(300);
	const [isSidebarResizing, setIsSidebarResizing] = useState(false);

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
						renderEmptyState={() => (
							<div className="flex h-full w-full flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground select-text">
								Open a file from one of this workspace's roots to get started.
							</div>
						)}
					/>
				)}
			</div>
		</div>
	);
}
