import { LuFolderPlus } from "react-icons/lu";

/**
 * Empty multi-root workspace ("group") state (Q5 default: empty groups are
 * allowed and prompt the user to add a root). The actual "Add a folder or
 * workspace" management UI lands in M5; this is the in-shell prompt shown when
 * a group has zero roots.
 */
export function GroupEmptyState({ groupName }: { groupName: string }) {
	return (
		<div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<LuFolderPlus className="size-8 text-muted-foreground" />
			<div className="text-sm font-medium text-foreground select-text">
				{groupName} is empty
			</div>
			<div className="max-w-sm text-xs text-muted-foreground select-text">
				Add a folder or workspace to this multi-root workspace to start working
				across several repositories and folders at once.
			</div>
		</div>
	);
}
