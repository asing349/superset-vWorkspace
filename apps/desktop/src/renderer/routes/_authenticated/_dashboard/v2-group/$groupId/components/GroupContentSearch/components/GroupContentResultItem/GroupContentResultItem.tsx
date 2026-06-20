import { CommandPrimitive } from "@superset/ui/command";
import { FileIcon } from "renderer/lib/fileIcons";

interface GroupContentResultItemProps {
	value: string;
	fileName: string;
	relativePath: string;
	/** Owning root's display label (per-result root label, Q4). */
	rootLabel: string;
	line: number;
	column: number;
	/** The matched line's text (host-provided preview/snippet). */
	preview: string;
	onSelect: () => void;
}

/**
 * A single cross-root content-search match (one matched LINE). Mirrors
 * `GroupFileResultItem` (icon + file name + relative path + per-root label), but
 * the headline is the matched line's text (the `preview` snippet) with its
 * `line:column`, since a content match is a line, not a whole file. The full
 * relative path + root label are shown as secondary context so the user can tell
 * which root and file a match came from.
 */
export function GroupContentResultItem({
	value,
	fileName,
	relativePath,
	rootLabel,
	line,
	column,
	preview,
	onSelect,
}: GroupContentResultItemProps) {
	return (
		<CommandPrimitive.Item
			value={value}
			onSelect={onSelect}
			className="group data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default flex-col gap-1 rounded-sm px-2 py-2 text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
		>
			<div className="flex w-full items-center gap-2">
				<FileIcon fileName={fileName} className="size-3.5 shrink-0" />
				<span className="max-w-[200px] truncate font-medium">{fileName}</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{line}:{column}
				</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
					{relativePath}
				</span>
				<span className="ml-auto shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[120px]">
					{rootLabel}
				</span>
				<kbd className="hidden shrink-0 text-xs text-muted-foreground group-data-[selected=true]:block">
					↵
				</kbd>
			</div>
			<code className="truncate pl-[1.375rem] font-mono text-muted-foreground text-xs">
				{preview.trim()}
			</code>
		</CommandPrimitive.Item>
	);
}
