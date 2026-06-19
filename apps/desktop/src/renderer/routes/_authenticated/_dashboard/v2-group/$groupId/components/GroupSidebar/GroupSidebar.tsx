import { useEffect, useRef, useState } from "react";
import { LuFile, LuGitCompareArrows } from "react-icons/lu";
import { SidebarHeader } from "../../../../v2-workspace/$workspaceId/components/WorkspaceSidebar/components/SidebarHeader";
import type { SidebarTabDefinition } from "../../../../v2-workspace/$workspaceId/components/WorkspaceSidebar/types";
import { GroupChangesTab } from "../GroupChangesTab";
import { GroupFilesTab } from "../GroupFilesTab";
import { GroupManageButton } from "../GroupManageButton";

type GroupSidebarTabId = "files" | "changes";

const VALID_TAB_IDS: readonly GroupSidebarTabId[] = ["files", "changes"];

function isGroupSidebarTabId(tab: string): tab is GroupSidebarTabId {
	return (VALID_TAB_IDS as readonly string[]).includes(tab);
}

export interface GroupSelectFileInput {
	rootId: string;
	filePath: string;
	openInNewTab?: boolean;
}

interface GroupSidebarProps {
	/** Open a file from a root (threads `rootId` for `{ groupId, rootId }` reads). */
	onSelectFile: (input: GroupSelectFileInput) => void;
	/** Absolute path of the currently active file pane, for selection highlight. */
	selectedFilePath?: string;
}

/**
 * Multi-root workspace ("group") sidebar — the group analogue of
 * `WorkspaceSidebar`, mirroring its tabbed structure (`SidebarHeader` +
 * `SidebarTabDefinition`) but with only the Files and Changes tabs that M4
 * delivers (the single-workspace Review/PR flow is workspace-scoped and out of
 * scope here).
 *
 * Active-tab state is component-local: unlike the single-workspace sidebar,
 * the group's renderer-local collection (`v2WorkspaceGroupLocalState`,
 * owned by M3) intentionally persists only the pane layout, so the active tab
 * is ephemeral rather than persisted. See Surprises & Discoveries.
 */
export function GroupSidebar({
	onSelectFile,
	selectedFilePath,
}: GroupSidebarProps) {
	const [activeTab, setActiveTab] = useState<GroupSidebarTabId>("files");

	const containerRef = useRef<HTMLDivElement>(null);
	const [compact, setCompact] = useState(false);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const width = entry.contentRect.width;
			// Hysteresis so labels don't jitter on the breakpoint (matches
			// WorkspaceSidebar).
			setCompact((prev) => (prev ? width < 280 : width < 260));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// The manage action (add/remove/reorder/set-default/rename) lives in the
	// header so it's reachable while a group is open; it refreshes this shell's
	// `workspaceGroup.get` directly (see GroupManageButton).
	const manageAction = <GroupManageButton variant="icon" />;

	const filesTab: SidebarTabDefinition = {
		id: "files",
		label: "Files",
		icon: LuFile,
		actions: manageAction,
		content: (
			<GroupFilesTab
				selectedFilePath={selectedFilePath}
				onSelectFile={onSelectFile}
			/>
		),
	};

	const changesTab: SidebarTabDefinition = {
		id: "changes",
		label: "Changes",
		icon: LuGitCompareArrows,
		actions: manageAction,
		content: (
			<GroupChangesTab
				selectedFilePath={selectedFilePath}
				onSelectFile={onSelectFile}
			/>
		),
	};

	const tabs: SidebarTabDefinition[] = [filesTab, changesTab];
	const activeTabDef = tabs.find((t) => t.id === activeTab);

	return (
		<div
			ref={containerRef}
			className="isolate flex h-full w-full min-h-0 flex-col overflow-hidden bg-background"
		>
			<SidebarHeader
				tabs={tabs}
				activeTab={activeTab}
				onTabChange={(tab) => {
					if (isGroupSidebarTabId(tab)) setActiveTab(tab);
				}}
				compact={compact}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{activeTabDef?.content}
			</div>
		</div>
	);
}
