import { CommandPrimitive } from "@superset/ui/command";
import { FileIcon } from "renderer/lib/fileIcons";

interface GroupFileResultItemProps {
	value: string;
	fileName: string;
	relativePath: string;
	/** Owning root's display label (per-result root label, Q4). */
	rootLabel: string;
	onSelect: () => void;
}

/**
 * A single cross-root quick-open result. Mirrors the single-workspace
 * `FileResultItem` (icon + file name + relative path) but adds a per-result
 * root-label badge so the user can tell which root a match came from — the
 * defining UX difference for a multi-root quick-open.
 */
export function GroupFileResultItem({
	value,
	fileName,
	relativePath,
	rootLabel,
	onSelect,
}: GroupFileResultItemProps) {
	return (
		<CommandPrimitive.Item
			value={value}
			onSelect={onSelect}
			className="group data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
		>
			<FileIcon fileName={fileName} className="size-3.5 shrink-0" />
			<span className="max-w-[200px] truncate font-medium">{fileName}</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
				{relativePath}
			</span>
			<span className="ml-auto shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[120px]">
				{rootLabel}
			</span>
			<kbd className="hidden shrink-0 text-xs text-muted-foreground group-data-[selected=true]:block">
				↵
			</kbd>
		</CommandPrimitive.Item>
	);
}
