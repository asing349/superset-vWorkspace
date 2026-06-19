import { cn } from "@superset/ui/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import type { FileTreeNode } from "renderer/hooks/host-service/useFileTree";
import { FileIcon } from "renderer/lib/fileIcons";

const ROW_HEIGHT = 24;
const INDENT_PER_LEVEL = 12;

interface GroupFileTreeRowProps {
	node: FileTreeNode;
	level: number;
	selectedFilePath?: string;
	onToggleDirectory: (absolutePath: string) => void;
	onSelectFile: (absolutePath: string, openInNewTab?: boolean) => void;
}

/**
 * One row of a single root's file tree, rendered recursively.
 *
 * Directories toggle expansion on click; files call `onSelectFile` with their
 * absolute path. Each tree is independent (its own `useFileTree` instance lives
 * in the parent section), so `absolutePath` is always within this root.
 */
export function GroupFileTreeRow({
	node,
	level,
	selectedFilePath,
	onToggleDirectory,
	onSelectFile,
}: GroupFileTreeRowProps) {
	const isDirectory = node.kind === "directory";
	const isSelected = !isDirectory && node.absolutePath === selectedFilePath;

	return (
		<>
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
			{isDirectory &&
				node.isExpanded &&
				node.children.map((child) => (
					<GroupFileTreeRow
						key={child.absolutePath}
						node={child}
						level={level + 1}
						selectedFilePath={selectedFilePath}
						onToggleDirectory={onToggleDirectory}
						onSelectFile={onSelectFile}
					/>
				))}
		</>
	);
}
