import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import { LuFolderPlus, LuLayers, LuPlus } from "react-icons/lu";
import { getBaseName } from "renderer/lib/pathBasename";
import type { AddableWorkspace } from "../../hooks/useAddableWorkspaces";
import { useSelectFolderRoot } from "../../hooks/useSelectFolderRoot";
import type { WorkspaceGroupRootInput } from "../../hooks/useWorkspaceGroups";
import { AddExistingWorkspaceDialog } from "../AddExistingWorkspaceDialog";

interface AddRootMenuProps {
	/** Workspace ids already present, hidden from the "existing workspace" picker. */
	existingWorkspaceIds: Set<string>;
	/** Receives a fully-formed root input ready for `workspaceGroup.addRoot`. */
	onAddRoot: (root: WorkspaceGroupRootInput) => void | Promise<void>;
	label?: string;
	disabled?: boolean;
}

/**
 * "Add root" affordance offering the two root sources the plan requires:
 *  1. "Add existing workspace" — pick a local worktree → emits
 *     `{ kind: "workspace", workspaceId, folderPath: null, label }`.
 *  2. "Add folder" — opens the native folder picker (same IPC the existing
 *     folder-first import uses) → emits
 *     `{ kind: "folder", workspaceId: null, folderPath, label }`.
 *
 * It only builds the root input and hands it to `onAddRoot`; the caller decides
 * whether to call `workspaceGroup.addRoot` (manage dialog) or accumulate it as
 * an initial root (create dialog).
 */
export function AddRootMenu({
	existingWorkspaceIds,
	onAddRoot,
	label = "Add root",
	disabled = false,
}: AddRootMenuProps) {
	const { selectFolder } = useSelectFolderRoot();
	const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);

	const handleAddFolder = async () => {
		try {
			const picked = await selectFolder();
			if (!picked) return;
			await onAddRoot({
				kind: "folder",
				workspaceId: null,
				folderPath: picked.folderPath,
				label: getBaseName(picked.folderPath),
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not add folder",
			);
		}
	};

	const handleAddWorkspace = async (workspace: AddableWorkspace) => {
		try {
			await onAddRoot({
				kind: "workspace",
				workspaceId: workspace.id,
				folderPath: null,
				label: workspace.name,
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not add workspace",
			);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled}
						className="gap-1.5"
					>
						<LuPlus className="size-4" />
						{label}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onSelect={() => setWorkspaceDialogOpen(true)}>
						<LuLayers className="mr-2 size-4" />
						Add existing workspace
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void handleAddFolder()}>
						<LuFolderPlus className="mr-2 size-4" />
						Add folder
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AddExistingWorkspaceDialog
				open={workspaceDialogOpen}
				onOpenChange={setWorkspaceDialogOpen}
				existingWorkspaceIds={existingWorkspaceIds}
				onSelect={(workspace) => void handleAddWorkspace(workspace)}
			/>
		</>
	);
}
