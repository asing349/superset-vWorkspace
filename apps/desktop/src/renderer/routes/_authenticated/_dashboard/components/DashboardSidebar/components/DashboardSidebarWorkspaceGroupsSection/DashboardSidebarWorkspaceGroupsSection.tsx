import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { HiChevronRight, HiMiniPlus } from "react-icons/hi2";
import { LuLayers, LuPencil, LuSettings2, LuTrash2 } from "react-icons/lu";
import { RenameInput } from "renderer/screens/main/components/WorkspaceSidebar/RenameInput";
import type { ResolvedWorkspaceGroup } from "../../hooks/useWorkspaceGroups";
import { useWorkspaceGroups } from "../../hooks/useWorkspaceGroups";
import { WorkspaceGroupCreateDialog } from "../WorkspaceGroupCreateDialog";
import { WorkspaceGroupManageDialog } from "../WorkspaceGroupManageDialog";

interface DashboardSidebarWorkspaceGroupsSectionProps {
	isCollapsed?: boolean;
}

/**
 * Dashboard sidebar "Multi-root workspaces" section. Lists the groups from
 * `workspaceGroup.list`, navigates each to its `/v2-group/$groupId` route, and
 * exposes a `+` action to create one plus a per-group context menu wired to
 * rename / manage (add-root / remove / reorder / set-default) / delete.
 */
export function DashboardSidebarWorkspaceGroupsSection({
	isCollapsed = false,
}: DashboardSidebarWorkspaceGroupsSectionProps) {
	const { groups, isReady, rename, deleteGroup } = useWorkspaceGroups();
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const activeGroupMatch = matchRoute({ to: "/v2-group/$groupId" });
	const activeGroupId = activeGroupMatch ? activeGroupMatch.groupId : null;

	const [sectionCollapsed, setSectionCollapsed] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [manageGroup, setManageGroup] = useState<ResolvedWorkspaceGroup | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] =
		useState<ResolvedWorkspaceGroup | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");

	// The manage dialog renders off `manageGroup`; keep it pointed at the live
	// row so add/remove/reorder reflect without reopening.
	const liveManageGroup = useMemo(
		() =>
			manageGroup
				? (groups.find((group) => group.id === manageGroup.id) ?? manageGroup)
				: null,
		[groups, manageGroup],
	);

	const openGroup = (groupId: string) => {
		void navigate({ to: "/v2-group/$groupId", params: { groupId } });
	};

	const startRename = (group: ResolvedWorkspaceGroup) => {
		setRenamingId(group.id);
		setRenameDraft(group.name);
	};

	const submitRename = async (group: ResolvedWorkspaceGroup) => {
		const trimmed = renameDraft.trim();
		setRenamingId(null);
		if (!trimmed || trimmed === group.name) return;
		try {
			await rename({ id: group.id, name: trimmed });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not rename workspace",
			);
		}
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		const target = deleteTarget;
		setDeleteTarget(null);
		try {
			await deleteGroup({ id: target.id });
			if (activeGroupId === target.id) {
				void navigate({ to: "/", replace: true });
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not delete workspace",
			);
		}
	};

	// Collapsed rail: a single icon button that creates a new multi-root
	// workspace (the per-group list is not shown in the narrow rail).
	if (isCollapsed) {
		return (
			<div className="flex flex-col items-center border-b border-border py-1">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="New multi-root workspace"
							onClick={() => setCreateOpen(true)}
							className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
						>
							<LuLayers className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Multi-root workspaces</TooltipContent>
				</Tooltip>
				<WorkspaceGroupCreateDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
				/>
			</div>
		);
	}

	// Cache-first (AGENTS.md #9): once known-empty AND ready, render nothing so
	// the section stays out of the way until the user creates one. While not
	// ready with no data, also render nothing (no skeleton needed for a switcher
	// entry); existing rows always render.
	if (groups.length === 0 && isReady) {
		return (
			<>
				<div className="border-b border-border">
					<WorkspaceGroupsSectionHeader
						collapsed={sectionCollapsed}
						onToggle={() => setSectionCollapsed((prev) => !prev)}
						onCreate={() => setCreateOpen(true)}
						count={0}
					/>
				</div>
				<WorkspaceGroupCreateDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
				/>
			</>
		);
	}

	if (groups.length === 0) {
		return (
			<WorkspaceGroupCreateDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
		);
	}

	return (
		<div className="border-b border-border">
			<WorkspaceGroupsSectionHeader
				collapsed={sectionCollapsed}
				onToggle={() => setSectionCollapsed((prev) => !prev)}
				onCreate={() => setCreateOpen(true)}
				count={groups.length}
			/>

			{!sectionCollapsed && (
				<ul className="pb-1">
					{groups.map((group) => {
						const isActive = activeGroupId === group.id;
						const isRenaming = renamingId === group.id;
						return (
							<li key={group.id}>
								<ContextMenu>
									<ContextMenuTrigger asChild>
										{/* biome-ignore lint/a11y/noStaticElementInteractions: Row is a single navigation target with nested inline rename. */}
										<div
											role={isRenaming ? undefined : "button"}
											tabIndex={isRenaming ? undefined : 0}
											onClick={
												isRenaming ? undefined : () => openGroup(group.id)
											}
											onDoubleClick={
												isRenaming ? undefined : () => startRename(group)
											}
											onKeyDown={
												isRenaming
													? undefined
													: (event) => {
															if (event.key === "Enter" || event.key === " ") {
																event.preventDefault();
																openGroup(group.id);
															}
														}
											}
											className={cn(
												"group flex w-full items-center gap-2 pl-6 pr-2 py-1.5 text-sm",
												"transition-colors hover:bg-muted/50",
												isActive && "bg-accent text-foreground",
											)}
										>
											<LuLayers className="size-4 shrink-0 text-muted-foreground" />
											{isRenaming ? (
												<RenameInput
													value={renameDraft}
													onChange={setRenameDraft}
													onSubmit={() => void submitRename(group)}
													onCancel={() => setRenamingId(null)}
													className="-ml-1 h-6 min-w-0 flex-1 bg-transparent border-none px-1 py-0 text-sm outline-none"
												/>
											) : (
												<span
													className="min-w-0 flex-1 truncate"
													title={group.name}
												>
													{group.name}
												</span>
											)}
											{!isRenaming && (
												<Tooltip delayDuration={500}>
													<TooltipTrigger asChild>
														<button
															type="button"
															aria-label="Manage multi-root workspace"
															onClick={(event) => {
																event.stopPropagation();
																setManageGroup(group);
															}}
															onKeyDown={(event) => event.stopPropagation()}
															className="hidden size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted group-hover:flex focus-visible:flex focus-visible:outline-none"
														>
															<LuSettings2 className="size-4 text-muted-foreground" />
														</button>
													</TooltipTrigger>
													<TooltipContent side="bottom" sideOffset={4}>
														Manage
													</TooltipContent>
												</Tooltip>
											)}
											{!isRenaming && (
												<span className="text-[10px] tabular-nums text-muted-foreground group-hover:hidden">
													{group.roots.length}
												</span>
											)}
										</div>
									</ContextMenuTrigger>
									<ContextMenuContent
										onCloseAutoFocus={(event) => event.preventDefault()}
									>
										<ContextMenuItem onSelect={() => openGroup(group.id)}>
											<LuLayers className="mr-2 size-4" />
											Open
										</ContextMenuItem>
										<ContextMenuItem onSelect={() => setManageGroup(group)}>
											<LuSettings2 className="mr-2 size-4" />
											Manage roots
										</ContextMenuItem>
										<ContextMenuItem onSelect={() => startRename(group)}>
											<LuPencil className="mr-2 size-4" />
											Rename
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											onSelect={() => setDeleteTarget(group)}
											className="text-destructive focus:text-destructive"
										>
											<LuTrash2 className="mr-2 size-4 text-destructive" />
											Delete
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							</li>
						);
					})}
				</ul>
			)}

			<WorkspaceGroupCreateDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>

			{liveManageGroup && (
				<WorkspaceGroupManageDialog
					open={manageGroup !== null}
					onOpenChange={(open) => {
						if (!open) setManageGroup(null);
					}}
					group={liveManageGroup}
				/>
			)}

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete multi-root workspace?</AlertDialogTitle>
						<AlertDialogDescription className="select-text">
							This removes the “{deleteTarget?.name}” grouping. The underlying
							repositories and folders are not deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void confirmDelete()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function WorkspaceGroupsSectionHeader({
	collapsed,
	onToggle,
	onCreate,
	count,
}: {
	collapsed: boolean;
	onToggle: () => void;
	onCreate: () => void;
	count: number;
}) {
	return (
		<div className="group flex min-h-9 w-full items-center pl-3 pr-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
			<button
				type="button"
				aria-expanded={!collapsed}
				onClick={onToggle}
				className="flex min-w-0 flex-1 items-center text-left outline-none"
			>
				<HiChevronRight
					className={cn(
						"size-4 shrink-0 transition-transform",
						!collapsed && "rotate-90",
					)}
				/>
				<span className="ml-1 flex-1 truncate uppercase tracking-wide">
					Multi-root workspaces
				</span>
			</button>
			<Tooltip delayDuration={500}>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="New multi-root workspace"
						onClick={onCreate}
						className="hidden size-6 items-center justify-center rounded transition-colors hover:bg-muted group-hover:flex focus-visible:flex focus-visible:outline-none"
					>
						<HiMiniPlus className="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={4}>
					New multi-root workspace
				</TooltipContent>
			</Tooltip>
			{count > 0 && (
				<span className="ml-1 text-[10px] tabular-nums text-muted-foreground group-hover:hidden">
					{count}
				</span>
			)}
		</div>
	);
}
