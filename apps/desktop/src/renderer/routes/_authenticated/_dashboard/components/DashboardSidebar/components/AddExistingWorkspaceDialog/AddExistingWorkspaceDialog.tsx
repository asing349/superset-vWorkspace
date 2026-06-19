import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { ScrollArea } from "@superset/ui/scroll-area";
import { cn } from "@superset/ui/utils";
import { useMemo, useState } from "react";
import { LuGitBranch, LuSearch } from "react-icons/lu";
import {
	type AddableWorkspace,
	useAddableWorkspaces,
} from "../../hooks/useAddableWorkspaces";

interface AddExistingWorkspaceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Workspace ids already in the group, hidden from the picker. */
	existingWorkspaceIds: Set<string>;
	/** Called with the chosen workspace so the caller can add it as a root. */
	onSelect: (workspace: AddableWorkspace) => void;
}

/**
 * Picks one of the user's existing local worktrees to add to a multi-root
 * workspace as a `kind: "workspace"` root. The list is the local-host
 * `v2Workspaces` collection (see `useAddableWorkspaces`); workspaces already in
 * the group are filtered out.
 */
export function AddExistingWorkspaceDialog({
	open,
	onOpenChange,
	existingWorkspaceIds,
	onSelect,
}: AddExistingWorkspaceDialogProps) {
	const { workspaces, isReady } = useAddableWorkspaces();
	const [search, setSearch] = useState("");

	const available = useMemo(
		() =>
			workspaces.filter((workspace) => !existingWorkspaceIds.has(workspace.id)),
		[existingWorkspaceIds, workspaces],
	);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return available;
		return available.filter((workspace) =>
			`${workspace.projectName} ${workspace.name} ${workspace.branch}`
				.toLowerCase()
				.includes(query),
		);
	}, [available, search]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal>
			<DialogContent className="max-w-[440px]">
				<DialogHeader>
					<DialogTitle>Add existing workspace</DialogTitle>
					<DialogDescription>
						Pick a worktree on this device to add as a root.
					</DialogDescription>
				</DialogHeader>

				<div className="relative">
					<LuSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search workspaces"
						className="pl-8"
						autoFocus
					/>
				</div>

				<ScrollArea className="max-h-[320px]">
					<div className="flex flex-col gap-1 pr-2">
						{filtered.length === 0 ? (
							<div className="px-2 py-8 text-center text-sm text-muted-foreground select-text">
								{available.length === 0
									? isReady
										? "No workspaces on this device are available to add."
										: "Loading workspaces…"
									: "No workspaces match your search."}
							</div>
						) : (
							filtered.map((workspace) => (
								<button
									key={workspace.id}
									type="button"
									onClick={() => {
										onSelect(workspace);
										onOpenChange(false);
									}}
									className={cn(
										"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left",
										"transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
									)}
								>
									<span className="truncate text-sm font-medium text-foreground">
										{workspace.name}
									</span>
									<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<span className="truncate">{workspace.projectName}</span>
										<LuGitBranch className="size-3 shrink-0" />
										<span className="truncate">{workspace.branch}</span>
									</span>
								</button>
							))
						)}
					</div>
				</ScrollArea>

				<div className="flex justify-end">
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
