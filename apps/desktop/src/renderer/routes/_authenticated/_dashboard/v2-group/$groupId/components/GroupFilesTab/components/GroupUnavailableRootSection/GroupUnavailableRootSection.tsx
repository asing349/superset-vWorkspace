import { TriangleAlert } from "lucide-react";
import type { ResolvedGroupRoot } from "../../../../providers/WorkspaceGroupProvider";

interface GroupUnavailableRootSectionProps {
	root: ResolvedGroupRoot;
}

/**
 * Section rendered for a root whose `rootPath` does not currently exist on disk
 * (`exists: false`) — e.g. a deleted worktree or a removed folder. It shows the
 * root as unavailable rather than instantiating a `useFileTree` that would fail
 * to list, so a broken root never crashes the whole explorer.
 */
export function GroupUnavailableRootSection({
	root,
}: GroupUnavailableRootSectionProps) {
	return (
		<div className="flex flex-col">
			<div className="flex h-7 shrink-0 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				<span className="truncate" title={root.label}>
					{root.label}
				</span>
			</div>
			<div className="flex items-start gap-2 px-3 py-2 text-xs text-muted-foreground select-text">
				<TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
				<span>
					This root is unavailable. Its path could not be found on disk:{" "}
					<span className="break-all font-mono">{root.rootPath}</span>
				</span>
			</div>
		</div>
	);
}
