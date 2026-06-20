import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { BsTerminalPlus } from "react-icons/bs";
import { LuFolderGit2, LuLayers } from "react-icons/lu";
import type { ResolvedGroupRoot } from "../../providers/WorkspaceGroupProvider";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";
import { CombinedAgentRootsHint } from "../CombinedAgentRootsHint";

interface GroupAddTabMenuProps {
	/** Open a terminal targeting the given root (cwd = that root). */
	onAddRootTerminal: (rootId: string) => void;
	/** Launch the combined agent terminal (cwd = synthetic agent root). */
	onLaunchAgent: () => void;
	/**
	 * The roots the combined agent will see (exists-only, matching
	 * `prepareAgentRoot`). Drives the "N roots visible to the combined agent"
	 * hint shown beneath the launch action.
	 */
	agentVisibleRoots: ResolvedGroupRoot[];
	/**
	 * True when a combined agent is already running and the root set changed since
	 * it launched — surfaces a "relaunch to include new roots" nudge.
	 */
	agentRootsChangedSinceLaunch: boolean;
}

/**
 * "+" / add-tab menu for the multi-root workspace ("group") shell, mirroring the
 * single-workspace `AddTabMenu` but offering the two group-specific terminal
 * actions:
 *
 *  - "New Terminal" — opens a terminal in the group's default root (its
 *    `defaultRootId`, else the first root). A "New Terminal in…" submenu lets
 *    the user target any specific root instead.
 *  - "Launch combined agent" — prepares the synthetic agent root (one symlink
 *    per root) and opens a terminal there so a single CLI agent can see every
 *    root at once (`SUPERSET_ROOTS` set).
 *
 * Empty-group safety: this menu is only rendered when the group has at least one
 * root (the page hides the add-tab menu for empty groups), so `defaultRoot` is
 * always present here.
 */
export function GroupAddTabMenu({
	onAddRootTerminal,
	onLaunchAgent,
	agentVisibleRoots,
	agentRootsChangedSinceLaunch,
}: GroupAddTabMenuProps) {
	const { roots, defaultRoot } = useWorkspaceGroup();

	return (
		<>
			<DropdownMenuItem
				className="gap-2"
				disabled={!defaultRoot}
				onClick={() => {
					if (defaultRoot) onAddRootTerminal(defaultRoot.rootId);
				}}
			>
				<BsTerminalPlus className="size-4" />
				<span>New Terminal</span>
				{defaultRoot && (
					<span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
						{defaultRoot.label}
					</span>
				)}
			</DropdownMenuItem>

			{roots.length > 1 && (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="gap-2">
						<LuFolderGit2 className="size-4" />
						<span>New Terminal in…</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
						{roots.map((root) => (
							<DropdownMenuItem
								key={root.rootId}
								className="gap-2"
								disabled={!root.exists}
								onClick={() => onAddRootTerminal(root.rootId)}
							>
								<LuFolderGit2 className="size-4 shrink-0" />
								<span className="min-w-0 truncate">{root.label}</span>
								{!root.exists && (
									<span className="ml-auto pl-2 text-xs text-muted-foreground">
										unavailable
									</span>
								)}
							</DropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			)}

			<DropdownMenuSeparator />

			<DropdownMenuItem className="gap-2" onClick={onLaunchAgent}>
				<LuLayers className="size-4" />
				<span>Launch combined agent</span>
			</DropdownMenuItem>

			{/* Non-interactive scope hint for the combined agent. Count + labels are
			    exists-only, matching what prepareAgentRoot symlinks. */}
			<div className="px-2 pt-1 pb-1.5">
				<CombinedAgentRootsHint
					visibleRoots={agentVisibleRoots}
					rootsChangedSinceLaunch={agentRootsChangedSinceLaunch}
				/>
			</div>
		</>
	);
}
