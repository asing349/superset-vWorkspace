import { Button } from "@superset/ui/button";
import { useState } from "react";
import { LuSettings2 } from "react-icons/lu";
import { WorkspaceGroupManageDialog } from "../../../../components/DashboardSidebar/components/WorkspaceGroupManageDialog";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

interface GroupManageButtonProps {
	/** Visual style: a labelled button (empty state) or a compact icon. */
	variant?: "button" | "icon";
}

/**
 * In-shell entry point to the multi-root workspace management dialog. Reuses
 * the same `WorkspaceGroupManageDialog` the sidebar uses, but passes the open
 * group's `refetchGroup` as `onMutated` so the group shell's `workspaceGroup.get`
 * (which lives in a separate per-host query client from the sidebar's `list`)
 * refreshes immediately after add/remove/reorder/rename/set-default.
 */
export function GroupManageButton({
	variant = "button",
}: GroupManageButtonProps) {
	const { group, refetchGroup } = useWorkspaceGroup();
	const [open, setOpen] = useState(false);

	return (
		<>
			{variant === "icon" ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Manage multi-root workspace"
					onClick={() => setOpen(true)}
				>
					<LuSettings2 className="size-4" />
				</Button>
			) : (
				<Button type="button" onClick={() => setOpen(true)} className="gap-1.5">
					<LuSettings2 className="size-4" />
					Add a folder or workspace
				</Button>
			)}

			<WorkspaceGroupManageDialog
				open={open}
				onOpenChange={setOpen}
				group={group}
				onMutated={() => refetchGroup()}
			/>
		</>
	);
}
