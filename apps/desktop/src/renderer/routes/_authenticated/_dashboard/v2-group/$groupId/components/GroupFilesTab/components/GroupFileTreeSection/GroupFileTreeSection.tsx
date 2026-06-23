import { alert } from "@superset/ui/atoms/Alert";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import {
	ChevronRight,
	FilePlus,
	FolderPlus,
	FoldVertical,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	type FileTreeAddressing,
	type FileTreeNode,
	useFileTree,
} from "renderer/hooks/host-service/useFileTree";
import { FileIcon } from "renderer/lib/fileIcons";
import type { ResolvedGroupRoot } from "../../../../providers/WorkspaceGroupProvider";
import { useGroupFilesTabActions } from "../../hooks/useGroupFilesTabActions";
import {
	getNameFromPath,
	pickDefaultEntryName,
} from "../../utils/groupTreePaths";
import { GroupFileTreeRow } from "../GroupFileTreeRow";
import { GroupTreeInlineInput } from "../GroupTreeInlineInput";
import { SectionHeaderButton } from "../SectionHeaderButton";
import type {
	GroupTreeEditingState,
	GroupTreeRowMenuHandlers,
} from "./editingState";

interface GroupFileTreeSectionProps {
	/** The group this root belongs to — folder roots address FS by it. */
	groupId: string;
	root: ResolvedGroupRoot;
	defaultOpen: boolean;
	selectedFilePath?: string;
	onSelectFile: (input: {
		rootId: string;
		absolutePath: string;
		openInNewTab?: boolean;
	}) => void;
}

/** Collect the basenames of every child currently known under `parentPath`. */
function collectSiblingNames(
	rootEntries: FileTreeNode[],
	parentPath: string,
): string[] {
	const walk = (nodes: FileTreeNode[]): string[] => {
		for (const node of nodes) {
			if (node.kind !== "directory") continue;
			if (node.absolutePath === parentPath) {
				return node.children.map((child) => child.name);
			}
			if (node.isExpanded) {
				const found = walk(node.children);
				if (found.length > 0) return found;
			}
		}
		return [];
	};
	return walk(rootEntries);
}

/**
 * One collapsible explorer section for a single resolved group root.
 *
 * Owns its OWN `useFileTree` instance (Q2 default: N independent trees), so the
 * tree's internal `reveal()`/path guards keep this root's paths isolated from
 * every other root's tree. Addressing is chosen by the root's `kind`:
 * `kind: "workspace"` roots read via `{ workspaceId }`; `kind: "folder"` roots
 * (no `workspaceId`) read via `{ groupId, rootId }` — the M1/M2 host contract.
 *
 * This component is only mounted for roots whose `exists` is true; unavailable
 * roots are rendered by `GroupUnavailableRootSection` (which calls no tree hook)
 * so the rules-of-hooks invariant holds across both shapes.
 *
 * A1: this section also owns the create/rename/delete mutation flow for its
 * root via `useGroupFilesTabActions` (write procs accept `{ workspaceId }` for
 * workspace roots, `{ groupId, rootId }` for folder roots). The tree refreshes
 * via the live `fs:events`/`fs:groupEvents` subscriptions `useFileTree` already
 * holds — no manual refetch is issued here.
 */
export function GroupFileTreeSection({
	groupId,
	root,
	defaultOpen,
	selectedFilePath,
	onSelectFile,
}: GroupFileTreeSectionProps) {
	const [open, setOpen] = useState(defaultOpen);
	const [editing, setEditing] = useState<GroupTreeEditingState | null>(null);

	// `kind: "workspace"` roots carry a real workspaceId; `kind: "folder"` roots
	// address by { groupId, rootId }. Build the discriminated addressing once.
	const addressing: FileTreeAddressing =
		root.kind === "workspace" && root.workspaceId
			? { workspaceId: root.workspaceId }
			: { groupId, rootId: root.rootId };

	const tree = useFileTree({ ...addressing, rootPath: root.rootPath });
	const actions = useGroupFilesTabActions({ groupId, root });

	const startCreate = useCallback(
		async (mode: "file" | "folder", parentAbsolutePath: string) => {
			// Ensure the parent is expanded so the placeholder input is visible.
			if (parentAbsolutePath !== root.rootPath) {
				await tree.expand(parentAbsolutePath);
			} else {
				setOpen(true);
			}
			const existingNames = collectSiblingNames(
				tree.rootEntries,
				parentAbsolutePath,
			);
			setEditing({
				kind: "create",
				parentAbsolutePath,
				mode,
				defaultName: pickDefaultEntryName({ mode, existingNames }),
			});
		},
		[root.rootPath, tree],
	);

	const menuHandlers = useMemo<GroupTreeRowMenuHandlers>(
		() => ({
			onNewFile: (parentAbsolutePath) =>
				void startCreate("file", parentAbsolutePath),
			onNewFolder: (parentAbsolutePath) =>
				void startCreate("folder", parentAbsolutePath),
			onStartRename: (absolutePath) =>
				setEditing({ kind: "rename", absolutePath }),
			onDelete: ({ absolutePath, isDirectory }) => {
				const name = getNameFromPath(absolutePath);
				const itemType = isDirectory ? "folder" : "file";
				alert({
					title: `Delete ${name}?`,
					description: `Are you sure you want to delete this ${itemType}? This action cannot be undone.`,
					actions: [
						{
							label: "Delete",
							variant: "destructive",
							onClick: () => {
								toast.promise(
									actions.deleteEntry({ absolutePath, isDirectory }),
									{
										loading: `Deleting ${name}...`,
										success: `Deleted ${name}`,
										error: `Failed to delete ${name}`,
									},
								);
							},
						},
						{ label: "Cancel", variant: "ghost" },
					],
				});
			},
		}),
		[actions, startCreate],
	);

	const handleCommitEdit = useCallback(
		(name: string) => {
			const current = editing;
			setEditing(null);
			if (!current) return;
			if (current.kind === "create") {
				if (current.mode === "folder") {
					void actions.createFolder({
						parentAbsolutePath: current.parentAbsolutePath,
						name,
					});
				} else {
					void actions.createFile({
						parentAbsolutePath: current.parentAbsolutePath,
						name,
					});
				}
				return;
			}
			void actions.rename({ absolutePath: current.absolutePath, name });
		},
		[actions, editing],
	);

	const handleCancelEdit = useCallback(() => setEditing(null), []);

	// A root-level create placeholder is rendered directly under the header (its
	// parent is the root path, which has no row of its own).
	const rootCreate =
		editing?.kind === "create" && editing.parentAbsolutePath === root.rootPath
			? editing
			: null;

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="flex min-h-0 flex-col"
		>
			<div className="group/section flex h-7 shrink-0 items-center bg-background pr-1">
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
				</CollapsibleTrigger>
				<div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/section:opacity-100">
					<SectionHeaderButton
						icon={FilePlus}
						label="New File"
						onClick={() => void startCreate("file", root.rootPath)}
					/>
					<SectionHeaderButton
						icon={FolderPlus}
						label="New Folder"
						onClick={() => void startCreate("folder", root.rootPath)}
					/>
					<SectionHeaderButton
						icon={RefreshCw}
						label="Refresh"
						loading={tree.isLoadingRoot}
						onClick={() => void tree.refreshAll()}
					/>
					<SectionHeaderButton
						icon={FoldVertical}
						label="Collapse folders"
						onClick={tree.collapseAll}
					/>
				</div>
			</div>
			<CollapsibleContent className="min-h-0">
				{tree.isLoadingRoot && tree.rootEntries.length === 0 ? (
					<div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						<span>Loading files...</span>
					</div>
				) : tree.rootEntries.length === 0 && !rootCreate ? (
					<div className="px-3 py-2 text-xs text-muted-foreground select-text">
						No files
					</div>
				) : (
					<div className="flex flex-col pb-1">
						{rootCreate && (
							<GroupTreeInlineInput
								initialValue={rootCreate.defaultName}
								level={0}
								icon={
									<FileIcon
										fileName={rootCreate.defaultName}
										isDirectory={rootCreate.mode === "folder"}
										className="size-4 shrink-0"
									/>
								}
								onCommit={handleCommitEdit}
								onCancel={handleCancelEdit}
							/>
						)}
						{tree.rootEntries.map((node) => (
							<GroupFileTreeRow
								key={node.absolutePath}
								node={node}
								level={0}
								selectedFilePath={selectedFilePath}
								editing={editing}
								menuHandlers={menuHandlers}
								onToggleDirectory={(absolutePath) =>
									void tree.toggle(absolutePath)
								}
								onSelectFile={(absolutePath, openInNewTab) =>
									onSelectFile({
										rootId: root.rootId,
										absolutePath,
										openInNewTab,
									})
								}
								onCommitEdit={handleCommitEdit}
								onCancelEdit={handleCancelEdit}
							/>
						))}
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
