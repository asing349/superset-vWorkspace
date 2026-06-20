import { cn } from "@superset/ui/utils";
import { LuLayers, LuTriangleAlert } from "react-icons/lu";
import type { ResolvedGroupRoot } from "../../providers/WorkspaceGroupProvider";

/**
 * Compact "N roots visible to the combined agent" hint, plus an optional
 * "relaunch to include new roots" nudge (Wave-2 M5).
 *
 * `visibleRoots` is exactly the set `prepareAgentRoot` will symlink
 * (exists-only) — `exists: false` roots are excluded by the caller
 * (`useCombinedAgentRoots`), so the count and label list match what the agent
 * actually sees. When `rootsChangedSinceLaunch` is true a running agent's view
 * is stale (it won't auto-see symlinks added/removed after it launched), so we
 * surface the relaunch nudge.
 */
export function CombinedAgentRootsHint({
	visibleRoots,
	rootsChangedSinceLaunch,
	className,
}: {
	visibleRoots: ResolvedGroupRoot[];
	rootsChangedSinceLaunch: boolean;
	className?: string;
}) {
	const count = visibleRoots.length;
	const labels = visibleRoots.map((root) => root.label).join(", ");
	const noun = count === 1 ? "root" : "roots";

	return (
		<div
			className={cn(
				"flex flex-col gap-1 text-xs text-muted-foreground select-text",
				className,
			)}
		>
			<div className="flex items-start gap-1.5">
				<LuLayers className="mt-0.5 size-3.5 shrink-0" />
				<span className="min-w-0">
					<span className="font-medium text-foreground">
						{count} {noun}
					</span>{" "}
					visible to the combined agent
					{count > 0 && (
						<span className="text-muted-foreground"> — {labels}</span>
					)}
				</span>
			</div>
			{rootsChangedSinceLaunch && (
				<div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
					<LuTriangleAlert className="mt-0.5 size-3.5 shrink-0" />
					<span className="min-w-0">
						Roots changed since this agent launched — relaunch the combined
						agent to include them.
					</span>
				</div>
			)}
		</div>
	);
}
