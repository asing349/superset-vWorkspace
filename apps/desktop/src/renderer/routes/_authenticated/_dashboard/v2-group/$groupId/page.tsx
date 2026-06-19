import { Workspace } from "@superset/panes";
import { createFileRoute } from "@tanstack/react-router";
import type { PaneViewerData } from "../../v2-workspace/$workspaceId/types";
import { GroupEmptyState } from "./components/GroupEmptyState";
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

	// Q5 default: an empty group (zero roots) is allowed and shows an
	// "Add a folder or workspace" prompt rather than an empty editor.
	const isEmptyGroup = roots.length === 0;

	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<div
				className="flex min-h-0 min-w-[320px] flex-1 flex-col overflow-hidden"
				data-group-id={groupId}
			>
				{isEmptyGroup ? (
					<GroupEmptyState groupName={group.name} />
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
