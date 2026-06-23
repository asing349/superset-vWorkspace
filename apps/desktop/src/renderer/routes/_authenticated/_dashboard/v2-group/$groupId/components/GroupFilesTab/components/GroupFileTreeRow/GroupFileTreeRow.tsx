import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import { LuFilePlus, LuFolderPlus, LuPencil, LuTrash2 } from "react-icons/lu";
import type { FileTreeNode } from "renderer/hooks/host-service/useFileTree";
import { FileIcon } from "renderer/lib/fileIcons";
import { getNameFromPath } from "../../utils/groupTreePaths";
import type {
	GroupTreeEditingState,
	GroupTreeRowMenuHandlers,
} from "../GroupFileTreeSection/editingState";
import { GroupTreeInlineInput } from "../GroupTreeInlineInput";

const ROW_HEIGHT = 24;
const INDENT_PER_LEVEL = 12;

interface GroupFileTreeRowProps {
	node: FileTreeNode;
	level: number;
	selectedFilePath?: string;
	editing: GroupTreeEditingState | null;
	menuHandlers: GroupTreeRowMenuHandlers;
	onToggleDirectory: (absolutePath: string) => void;
	onSelectFile: (absolutePath: string, openInNewTab?: boolean) => void;
	/** Commit an inline create/rename for `name` (validated by the section). */
	onCommitEdit: (name: string) => void;
	/** Abandon the active inline edit. */
	onCancelEdit: () => void;
}

/**
 * One row of a single root's file tree, rendered recursively.
 *
 * Directories toggle expansion on click; files call `onSelectFile`. A11: each
 * row carries a right-click context menu (Rename / Delete, plus New File / New
 * Folder for directories) and renders an inline input when it is the active
 * rename target; a directory that is the active create parent renders the
 * placeholder input as its first child. Each tree is independent (its own
 * `useFileTree` instance lives in the parent section), so `absolutePath` is
 * always within this root.
 */
export function GroupFileTreeRow({
	node,
	level,
	selectedFilePath,
	editing,
	menuHandlers,
	onToggleDirectory,
	onSelectFile,
	onCommitEdit,
	onCancelEdit,
}: GroupFileTreeRowProps) {
	const isDirectory = node.kind === "directory";
	const isSelected = !isDirectory && node.absolutePath === selectedFilePath;

	const isRenaming =
		editing?.kind === "rename" && editing.absolutePath === node.absolutePath;
	const isCreateParent =
		editing?.kind === "create" &&
		isDirectory &&
		editing.parentAbsolutePath === node.absolutePath;

	if (isRenaming) {
		return (
			<GroupTreeInlineInput
				initialValue={getNameFromPath(node.absolutePath)}
				level={level}
				icon={
					<FileIcon
						fileName={node.name}
						isDirectory={isDirectory}
						isOpen={isDirectory && node.isExpanded}
						className="size-4 shrink-0"
					/>
				}
				onCommit={onCommitEdit}
				onCancel={onCancelEdit}
			/>
		);
	}

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						title={node.name}
						onClick={(event) => {
							if (isDirectory) {
								onToggleDirectory(node.absolutePath);
								return;
							}
							onSelectFile(node.absolutePath, event.metaKey || event.ctrlKey);
						}}
						className={cn(
							"flex w-full items-center gap-1 truncate pr-2 text-left text-[13px] text-foreground/90 hover:bg-muted/60",
							isSelected && "bg-muted",
						)}
						style={{
							height: ROW_HEIGHT,
							paddingLeft: 4 + level * INDENT_PER_LEVEL,
						}}
					>
						<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
							{isDirectory ? (
								node.isLoading ? (
									<Loader2 className="size-3 animate-spin" />
								) : (
									<ChevronRight
										className={cn(
											"size-3 transition-transform",
											node.isExpanded && "rotate-90",
										)}
									/>
								)
							) : null}
						</span>
						<FileIcon
							fileName={node.name}
							isDirectory={isDirectory}
							isOpen={isDirectory && node.isExpanded}
							className="size-4 shrink-0"
						/>
						<span className="truncate">{node.name}</span>
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-44">
					{isDirectory && (
						<>
							<ContextMenuItem
								onSelect={() => menuHandlers.onNewFile(node.absolutePath)}
							>
								<LuFilePlus className="size-4" />
								New File
							</ContextMenuItem>
							<ContextMenuItem
								onSelect={() => menuHandlers.onNewFolder(node.absolutePath)}
							>
								<LuFolderPlus className="size-4" />
								New Folder
							</ContextMenuItem>
							<ContextMenuSeparator />
						</>
					)}
					<ContextMenuItem
						onSelect={() => menuHandlers.onStartRename(node.absolutePath)}
					>
						<LuPencil className="size-4" />
						Rename
					</ContextMenuItem>
					<ContextMenuItem
						variant="destructive"
						onSelect={() =>
							menuHandlers.onDelete({
								absolutePath: node.absolutePath,
								isDirectory,
							})
						}
					>
						<LuTrash2 className="size-4" />
						Delete
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{isDirectory && node.isExpanded && (
				<>
					{isCreateParent && editing.kind === "create" && (
						<GroupTreeInlineInput
							initialValue={editing.defaultName}
							level={level + 1}
							icon={
								<FileIcon
									fileName={editing.defaultName}
									isDirectory={editing.mode === "folder"}
									className="size-4 shrink-0"
								/>
							}
							onCommit={onCommitEdit}
							onCancel={onCancelEdit}
						/>
					)}
					{node.children.map((child) => (
						<GroupFileTreeRow
							key={child.absolutePath}
							node={child}
							level={level + 1}
							selectedFilePath={selectedFilePath}
							editing={editing}
							menuHandlers={menuHandlers}
							onToggleDirectory={onToggleDirectory}
							onSelectFile={onSelectFile}
							onCommitEdit={onCommitEdit}
							onCancelEdit={onCancelEdit}
						/>
					))}
				</>
			)}
		</>
	);
}
