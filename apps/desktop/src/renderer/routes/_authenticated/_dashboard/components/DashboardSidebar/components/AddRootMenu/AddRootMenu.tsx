import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import {
	LuFolderPlus,
	LuGitBranchPlus,
	LuLayers,
	LuPlus,
} from "react-icons/lu";
import { getBaseName } from "renderer/lib/pathBasename";
import type { AddableWorkspace } from "../../hooks/useAddableWorkspaces";
import { useImportRepoRoot } from "../../hooks/useImportRepoRoot";
import { useSelectFolderRoot } from "../../hooks/useSelectFolderRoot";
import type { WorkspaceGroupRootInput } from "../../hooks/useWorkspaceGroups";
import { AddExistingWorkspaceDialog } from "../AddExistingWorkspaceDialog";
import { CreateWorktreeDialog } from "../CreateWorktreeDialog";

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
 *  3. "Create new worktree" (Wave-2 M3) — opens a compact picker that creates a
 *     fresh branch worktree in an imported project (host `workspaces.create`),
 *     then emits the resulting `{ kind: "workspace", workspaceId, ... }` root.
 *
 * It only builds the root input and hands it to `onAddRoot`; the caller decides
 * whether to call `workspaceGroup.addRoot` (manage dialog) or accumulate it as
 * an initial root (create dialog). All three sources funnel through the SAME
 * `onAddRoot` contract.
 */
export function AddRootMenu({
	existingWorkspaceIds,
	onAddRoot,
	label = "Add root",
	disabled = false,
}: AddRootMenuProps) {
	const { selectFolder } = useSelectFolderRoot();
	const { inspectFolder, ensureProject } = useImportRepoRoot();
	const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
	const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
	// When set, the worktree dialog is pinned to this just-imported project (the
	// M4 "Add folder → it's a repo" flow). null/undefined means the M3 path
	// (user picks any imported project).
	const [presetProjectId, setPresetProjectId] = useState<string | undefined>(
		undefined,
	);
	const [importing, setImporting] = useState(false);

	const handleAddFolder = async () => {
		try {
			const picked = await selectFolder();
			if (!picked) return;

			// Wave-2 M4: branch on whether the picked folder is a git repo with a
			// matchable/known project.
			setImporting(true);
			const classification = await inspectFolder({
				folderPath: picked.folderPath,
			});

			if (classification.kind === "not-a-repo") {
				// Plain folder — keep the wave-1 behavior (now editable via M1).
				await onAddRoot({
					kind: "folder",
					workspaceId: null,
					folderPath: picked.folderPath,
					label: getBaseName(picked.folderPath),
				});
				return;
			}

			if (classification.kind === "ambiguous") {
				toast.error(
					`Multiple projects use this repository (${classification.candidates.length}). Open the one you want from settings to set it up on this device, then add it via "Create new worktree".`,
				);
				return;
			}

			// A git repo: register/set it up as a first-class project, then open the
			// create-worktree dialog pinned to it so the user only chooses the
			// branch (M3's create-worktree-and-add flow does the rest).
			const { projectId } = await ensureProject({
				folderPath: picked.folderPath,
			});
			setPresetProjectId(projectId);
			setWorktreeDialogOpen(true);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not add folder",
			);
		} finally {
			setImporting(false);
		}
	};

	const handleOpenWorktreeDialog = (next: boolean) => {
		setWorktreeDialogOpen(next);
		// Clear the pin when the dialog closes so the next "Create new worktree"
		// (the M3 unpinned path) lets the user pick any project.
		if (!next) setPresetProjectId(undefined);
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
						disabled={disabled || importing}
						className="gap-1.5"
					>
						<LuPlus className="size-4" />
						{importing ? "Adding…" : label}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem
						onSelect={() => {
							// Unpinned M3 path — user picks any imported project.
							setPresetProjectId(undefined);
							setWorktreeDialogOpen(true);
						}}
					>
						<LuGitBranchPlus className="mr-2 size-4" />
						Create new worktree
					</DropdownMenuItem>
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

			<CreateWorktreeDialog
				open={worktreeDialogOpen}
				onOpenChange={handleOpenWorktreeDialog}
				onAddRoot={onAddRoot}
				presetProjectId={presetProjectId}
			/>

			<AddExistingWorkspaceDialog
				open={workspaceDialogOpen}
				onOpenChange={setWorkspaceDialogOpen}
				existingWorkspaceIds={existingWorkspaceIds}
				onSelect={(workspace) => void handleAddWorkspace(workspace)}
			/>
		</>
	);
}
