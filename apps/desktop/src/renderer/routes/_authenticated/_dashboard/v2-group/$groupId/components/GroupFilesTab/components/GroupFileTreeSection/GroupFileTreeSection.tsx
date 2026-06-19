import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { cn } from "@superset/ui/utils";
import { ChevronRight, FoldVertical, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
	type FileTreeAddressing,
	useFileTree,
} from "renderer/hooks/host-service/useFileTree";
import type { ResolvedGroupRoot } from "../../../../providers/WorkspaceGroupProvider";
import { GroupFileTreeRow } from "../GroupFileTreeRow";
import { SectionHeaderButton } from "../SectionHeaderButton";

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
 */
export function GroupFileTreeSection({
	groupId,
	root,
	defaultOpen,
	selectedFilePath,
	onSelectFile,
}: GroupFileTreeSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	// `kind: "workspace"` roots carry a real workspaceId; `kind: "folder"` roots
	// address by { groupId, rootId }. Build the discriminated addressing once.
	const addressing: FileTreeAddressing =
		root.kind === "workspace" && root.workspaceId
			? { workspaceId: root.workspaceId }
			: { groupId, rootId: root.rootId };

	const tree = useFileTree({ ...addressing, rootPath: root.rootPath });

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
				) : tree.rootEntries.length === 0 ? (
					<div className="px-3 py-2 text-xs text-muted-foreground select-text">
						No files
					</div>
				) : (
					<div className="flex flex-col pb-1">
						{tree.rootEntries.map((node) => (
							<GroupFileTreeRow
								key={node.absolutePath}
								node={node}
								level={0}
								selectedFilePath={selectedFilePath}
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
							/>
						))}
					</div>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
