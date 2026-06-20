import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { ScrollArea } from "@superset/ui/scroll-area";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useEffect, useMemo, useState } from "react";
import {
	LuChevronsUpDown,
	LuFolderGit2,
	LuGitBranch,
	LuLoaderCircle,
	LuSearch,
} from "react-icons/lu";
import { useBranchSearch } from "../../hooks/useBranchSearch";
import { useCreateWorktreeRoot } from "../../hooks/useCreateWorktreeRoot";
import type { WorkspaceGroupRootInput } from "../../hooks/useWorkspaceGroups";
import {
	useWorktreeProjects,
	type WorktreeProject,
} from "../../hooks/useWorktreeProjects";

interface CreateWorktreeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Receives the `kind:"workspace"` root for the freshly created worktree —
	 * the SAME `onAddRoot` contract `AddRootMenu` already drives, so the caller
	 * decides step 2: `workspaceGroup.addRoot` (an open/managed group) or
	 * accumulating it for a single `workspaceGroup.create` (the create dialog).
	 */
	onAddRoot: (root: WorkspaceGroupRootInput) => void | Promise<void>;
	/**
	 * Pre-select (and lock) the project picker to this host project id (Wave-2
	 * M4). The "Add folder → set up as project" / "Promote to repo" flow imports
	 * a repo to a known project id, then opens this dialog pinned to it so the
	 * user only chooses base + new branch. When omitted, the user picks any
	 * imported project (the M3 path).
	 */
	presetProjectId?: string;
}

/**
 * Compact "Create new worktree" picker (Wave-2 M3). Drives the SAME underlying
 * host query hooks the New Workspace flow uses — project list and
 * `workspaceCreation.searchBranches` — plus the host `workspaces.create`
 * procedure (via `useCreateWorktreeRoot`). On submit it performs the renderer
 * two-step: (1) create the worktree, then (2) hand the resulting
 * `kind:"workspace"` root to `onAddRoot`. Host errors (branch already checked
 * out, dirty tree, clone needed) are surfaced verbatim via toast — the same
 * catch-and-toast the New Workspace modal uses. If step 2 fails, the worktree
 * persists and is recoverable via "Add existing workspace"; we surface that and
 * do NOT attempt to delete the worktree.
 */
export function CreateWorktreeDialog({
	open,
	onOpenChange,
	onAddRoot,
	presetProjectId,
}: CreateWorktreeDialogProps) {
	const { projects, isReady: projectsReady } = useWorktreeProjects();
	const { createWorktree } = useCreateWorktreeRoot();

	const projectLocked = presetProjectId !== undefined;
	const [projectId, setProjectId] = useState<string | null>(
		presetProjectId ?? null,
	);
	const [projectPickerOpen, setProjectPickerOpen] = useState(false);
	const [projectQuery, setProjectQuery] = useState("");
	const [baseBranch, setBaseBranch] = useState<string | null>(null);
	const [branchPickerOpen, setBranchPickerOpen] = useState(false);
	const [branchQuery, setBranchQuery] = useState("");
	const [newBranch, setNewBranch] = useState("");
	const [working, setWorking] = useState(false);

	const selectedProject = useMemo<WorktreeProject | null>(
		() => projects.find((project) => project.id === projectId) ?? null,
		[projects, projectId],
	);

	const {
		branches,
		defaultBranch,
		isLoading: branchesLoading,
	} = useBranchSearch({
		projectId,
		query: branchQuery,
		enabled: open && projectId !== null,
	});

	// Default the base branch to the project's default branch once known and
	// while the user hasn't picked one for this project.
	useEffect(() => {
		if (projectId && baseBranch === null && defaultBranch) {
			setBaseBranch(defaultBranch);
		}
	}, [projectId, baseBranch, defaultBranch]);

	// When a preset project id is provided (the M4 import/promote flow), pin the
	// picker to it whenever the dialog opens or the preset changes, resetting the
	// base branch so the pinned project's default can apply.
	useEffect(() => {
		if (open && presetProjectId !== undefined) {
			setProjectId(presetProjectId);
			setBaseBranch(null);
			setBranchQuery("");
		}
	}, [open, presetProjectId]);

	const reset = () => {
		setProjectId(presetProjectId ?? null);
		setProjectQuery("");
		setBaseBranch(null);
		setBranchQuery("");
		setNewBranch("");
		setWorking(false);
	};

	const handleOpenChange = (next: boolean) => {
		if (!next && working) return;
		if (!next) reset();
		onOpenChange(next);
	};

	const handleSelectProject = (id: string) => {
		setProjectId(id);
		setProjectPickerOpen(false);
		setProjectQuery("");
		// Reset the base branch so the new project's default can apply.
		setBaseBranch(null);
		setBranchQuery("");
	};

	const filteredProjects = useMemo(() => {
		const query = projectQuery.trim().toLowerCase();
		if (!query) return projects;
		return projects.filter((project) =>
			`${project.name} ${project.repoPath}`.toLowerCase().includes(query),
		);
	}, [projects, projectQuery]);

	const trimmedBranch = newBranch.trim();
	const canSubmit = !working && projectId !== null && trimmedBranch.length > 0;

	const handleSubmit = async () => {
		if (!projectId || trimmedBranch.length === 0) return;
		setWorking(true);
		try {
			// Step 1 — create the worktree on the host.
			const created = await createWorktree({
				projectId,
				branch: trimmedBranch,
				baseBranch: baseBranch ?? undefined,
			});

			// Step 2 — hand the resulting workspace root to the caller (addRoot or
			// accumulate). A failure HERE leaves a real, reusable worktree.
			try {
				await onAddRoot({
					kind: "workspace",
					workspaceId: created.workspaceId,
					folderPath: null,
					label: created.label,
				});
			} catch (addRootError) {
				toast.error(
					addRootError instanceof Error
						? `Worktree "${created.label}" was created but could not be added to the workspace: ${addRootError.message}. You can add it with "Add existing workspace".`
						: `Worktree "${created.label}" was created but could not be added. You can add it with "Add existing workspace".`,
				);
				reset();
				onOpenChange(false);
				return;
			}

			toast.success(
				created.alreadyExists
					? `Added existing worktree "${created.label}"`
					: `Created worktree "${created.label}"`,
			);
			reset();
			onOpenChange(false);
		} catch (error) {
			// Host create errors (branch already checked out, dirty tree, clone
			// needed, project not set up) surface verbatim, like the New Workspace
			// modal's catch-and-toast.
			toast.error(
				error instanceof Error ? error.message : "Could not create worktree",
			);
			setWorking(false);
		}
	};

	const projectTriggerLabel = selectedProject
		? selectedProject.name
		: projectLocked
			? // Locked to the just-imported project; the list may still be loading
				// its enriched row.
				"Imported repository"
			: projectsReady
				? projects.length === 0
					? "No projects on this device"
					: "Select a project"
				: "Loading projects…";

	const baseBranchLabel = baseBranch ?? defaultBranch ?? "Select base branch";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange} modal>
			<DialogContent className="max-w-[440px]">
				<DialogHeader>
					<DialogTitle>Create new worktree</DialogTitle>
					<DialogDescription>
						Spin up a fresh branch worktree in one of your imported projects and
						add it as a root.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Project picker */}
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Project</Label>
						<Popover
							open={projectLocked ? false : projectPickerOpen}
							onOpenChange={projectLocked ? undefined : setProjectPickerOpen}
						>
							<PopoverTrigger asChild>
								<Button
									type="button"
									variant="outline"
									role="combobox"
									aria-expanded={projectPickerOpen}
									disabled={
										working ||
										projectLocked ||
										(projectsReady && projects.length === 0)
									}
									className="w-full justify-between gap-2 font-normal"
								>
									<span className="flex min-w-0 items-center gap-2">
										<LuFolderGit2 className="size-4 shrink-0 text-muted-foreground" />
										<span
											className={cn(
												"truncate",
												!selectedProject &&
													!projectLocked &&
													"text-muted-foreground",
											)}
										>
											{projectTriggerLabel}
										</span>
									</span>
									{!projectLocked && (
										<LuChevronsUpDown className="size-4 shrink-0 opacity-50" />
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="start"
								className="w-[var(--radix-popover-trigger-width)] p-0"
							>
								<div className="relative border-b border-border">
									<LuSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={projectQuery}
										onChange={(event) => setProjectQuery(event.target.value)}
										placeholder="Search projects"
										className="border-0 pl-8 focus-visible:ring-0"
										autoFocus
									/>
								</div>
								<ScrollArea className="max-h-[260px]">
									<div className="flex flex-col gap-0.5 p-1">
										{filteredProjects.length === 0 ? (
											<div className="px-2 py-6 text-center text-sm text-muted-foreground select-text">
												{projects.length === 0
													? projectsReady
														? "No imported projects on this device."
														: "Loading projects…"
													: "No projects match your search."}
											</div>
										) : (
											filteredProjects.map((project) => (
												<button
													key={project.id}
													type="button"
													onClick={() => handleSelectProject(project.id)}
													className={cn(
														"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
														"transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
														project.id === projectId && "bg-accent",
													)}
												>
													<span className="truncate text-sm font-medium text-foreground">
														{project.name}
													</span>
													<span
														className="w-full truncate text-xs text-muted-foreground"
														title={project.repoPath}
													>
														{project.repoPath}
													</span>
												</button>
											))
										)}
									</div>
								</ScrollArea>
							</PopoverContent>
						</Popover>
					</div>

					{/* Base branch selector */}
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs">Base branch</Label>
						<Popover open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									variant="outline"
									role="combobox"
									aria-expanded={branchPickerOpen}
									disabled={working || projectId === null}
									className="w-full justify-between gap-2 font-normal"
								>
									<span className="flex min-w-0 items-center gap-2">
										<LuGitBranch className="size-4 shrink-0 text-muted-foreground" />
										<span
											className={cn(
												"truncate",
												!baseBranch && "text-muted-foreground",
											)}
										>
											{baseBranchLabel}
										</span>
									</span>
									<LuChevronsUpDown className="size-4 shrink-0 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="start"
								className="w-[var(--radix-popover-trigger-width)] p-0"
							>
								<div className="relative border-b border-border">
									<LuSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={branchQuery}
										onChange={(event) => setBranchQuery(event.target.value)}
										placeholder="Search branches"
										className="border-0 pl-8 focus-visible:ring-0"
										autoFocus
									/>
								</div>
								<ScrollArea className="max-h-[260px]">
									<div className="flex flex-col gap-0.5 p-1">
										{branchesLoading ? (
											<div className="flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground">
												<LuLoaderCircle className="size-4 animate-spin" />
												Loading branches…
											</div>
										) : branches.length === 0 ? (
											<div className="px-2 py-6 text-center text-sm text-muted-foreground select-text">
												No branches match your search.
											</div>
										) : (
											branches.map((branch) => (
												<button
													key={branch.name}
													type="button"
													onClick={() => {
														setBaseBranch(branch.name);
														setBranchPickerOpen(false);
														setBranchQuery("");
													}}
													className={cn(
														"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
														"transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
														branch.name === baseBranch && "bg-accent",
													)}
												>
													<LuGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
													<span className="truncate">{branch.name}</span>
													{branch.name === defaultBranch && (
														<span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
															default
														</span>
													)}
												</button>
											))
										)}
									</div>
								</ScrollArea>
							</PopoverContent>
						</Popover>
					</div>

					{/* New branch name */}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="worktree-branch" className="text-xs">
							New branch
						</Label>
						<Input
							id="worktree-branch"
							value={newBranch}
							onChange={(event) => setNewBranch(event.target.value)}
							placeholder="my-feature"
							disabled={working || projectId === null}
							onKeyDown={(event) => {
								if (event.key === "Enter" && canSubmit) {
									void handleSubmit();
								}
							}}
						/>
						<p className="text-xs text-muted-foreground select-text">
							A worktree is created on this branch and added as a root.
						</p>
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => handleOpenChange(false)}
						disabled={working}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => void handleSubmit()}
						disabled={!canSubmit}
						className="gap-1.5"
					>
						{working && <LuLoaderCircle className="size-4 animate-spin" />}
						Create worktree
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
