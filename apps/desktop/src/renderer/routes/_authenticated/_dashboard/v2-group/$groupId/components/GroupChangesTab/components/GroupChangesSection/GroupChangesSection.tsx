import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { cn } from "@superset/ui/utils";
import { ChevronRight, GitBranch, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useGitStatus } from "renderer/hooks/host-service/useGitStatus";
import { FileIcon } from "renderer/lib/fileIcons";
import { getBaseName } from "renderer/lib/pathBasename";
import { toAbsoluteWorkspacePath } from "shared/absolute-paths";
import type { ResolvedGroupRoot } from "../../../../providers/WorkspaceGroupProvider";
import {
	type ChangeStatus,
	mergeChangedFiles,
	STATUS_LABEL,
} from "../../utils/mergeChangedFiles";

interface GroupChangesSectionProps {
	/** Always a `kind: "workspace"` root with a real `workspaceId`. */
	root: ResolvedGroupRoot;
	workspaceId: string;
	defaultOpen: boolean;
	selectedFilePath?: string;
	onSelectFile: (input: {
		rootId: string;
		absolutePath: string;
		openInNewTab?: boolean;
	}) => void;
}

const STATUS_COLOR: Record<ChangeStatus, string> = {
	added: "text-emerald-500",
	untracked: "text-emerald-500",
	modified: "text-amber-500",
	changed: "text-amber-500",
	deleted: "text-rose-500",
	renamed: "text-sky-500",
	copied: "text-sky-500",
};

/**
 * One collapsible Changes section for a single git root. Reuses the existing
 * single-worktree `useGitStatus` query keyed by this root's `workspaceId` — no
 * new git plumbing; the hook keeps itself live against `git:changed` events for
 * that workspace. Clicking a changed file opens it into the shared editor with
 * this root's `rootId`.
 */
export function GroupChangesSection({
	root,
	workspaceId,
	defaultOpen,
	selectedFilePath,
	onSelectFile,
}: GroupChangesSectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	const status = useGitStatus(workspaceId, open);

	const files = useMemo(() => mergeChangedFiles(status.data), [status.data]);
	const branchName = status.data?.currentBranch.name ?? null;

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="flex min-h-0 flex-col"
		>
			<div className="flex h-7 shrink-0 items-center bg-background pr-2">
				<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
					<ChevronRight
						className={cn(
							"size-3 shrink-0 transition-transform",
							open && "rotate-90",
						)}
					/>
					<span className="truncate" title={root.label}>
						{root.label}
					</span>
					{files.length > 0 && (
						<span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-4 tabular-nums text-muted-foreground">
							{files.length}
						</span>
					)}
				</CollapsibleTrigger>
				{branchName && (
					<span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
						<GitBranch className="size-3 shrink-0" />
						<span className="truncate" title={branchName}>
							{branchName}
						</span>
					</span>
				)}
			</div>
			<CollapsibleContent className="min-h-0">
				{status.isLoading && files.length === 0 ? (
					<div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>Loading changes...</span>
					</div>
				) : files.length === 0 ? (
					<div className="px-3 py-2 text-xs text-muted-foreground select-text">
						No changes
					</div>
				) : (
					<div className="flex flex-col pb-1">
						{files.map((file) => {
							const absolutePath = toAbsoluteWorkspacePath(
								root.rootPath,
								file.path,
							);
							const isSelected = absolutePath === selectedFilePath;
							return (
								<button
									key={file.path}
									type="button"
									title={file.path}
									onClick={(event) =>
										onSelectFile({
											rootId: root.rootId,
											absolutePath,
											openInNewTab: event.metaKey || event.ctrlKey,
										})
									}
									className={cn(
										"flex h-6 w-full items-center gap-1.5 px-3 text-left text-[13px] text-foreground/90 hover:bg-muted/60",
										isSelected && "bg-muted",
									)}
								>
									<FileIcon
										fileName={getBaseName(file.path)}
										className="size-4 shrink-0"
									/>
									<span className="truncate">{getBaseName(file.path)}</span>
									<span
										className={cn(
											"ml-auto shrink-0 text-[10px] font-semibold uppercase",
											STATUS_COLOR[file.status],
										)}
										title={file.status}
									>
										{STATUS_LABEL[file.status]}
									</span>
								</button>
							);
						})}
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
