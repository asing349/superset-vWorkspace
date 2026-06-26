import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { LuRefreshCw, LuShieldCheck } from "react-icons/lu";
import { useReviewerContextActions } from "../../hooks/useReviewerContext";
import type { ReviewerContextStatus } from "../../types";
import { summarizeReviewerContext } from "../../utils/summarizeReviewerContext";

interface ReviewerContextCardProps {
	/** The project this card manages. */
	projectId: string;
	/** Friendly display name (repo basename / cloud name). */
	name: string;
	/** The host-computed context status for this project. */
	status: ReviewerContextStatus;
}

/**
 * One project's AI-reviewer context card (Wave 6, M5) — the unit the
 * cross-project "Manage context" view stacks. Shows the configured/ready/changed
 * state (the pure `summarizeReviewerContext`), the per-layer change details when
 * the context moved, and its OWN explicit action: "Set up AI reviewer" when
 * unconfigured, "Refresh context" when configured. Never refreshes on its own —
 * the action fires only on click (M6 surfaces observed business rules here too).
 */
export function ReviewerContextCard({
	projectId,
	name,
	status,
}: ReviewerContextCardProps) {
	const { setUp, refresh, isSettingUp, isRefreshing } =
		useReviewerContextActions({ projectId });
	const summary = summarizeReviewerContext(status);

	return (
		<div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
			<div className="flex items-center gap-2">
				<span
					className="min-w-0 flex-1 truncate text-sm font-medium text-foreground select-text"
					title={status.repoPath ?? name}
				>
					{name}
				</span>
				<Badge
					variant={summary.state === "changed" ? "default" : "secondary"}
					className={cn(
						summary.state === "changed" &&
							"bg-amber-500/15 text-amber-600 hover:bg-amber-500/15",
					)}
				>
					{summary.badgeLabel}
				</Badge>
			</div>

			<p className="cursor-text select-text text-xs text-muted-foreground">
				{summary.description}
			</p>

			{summary.changeDetails.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{summary.changeDetails.map((detail) => (
						<li
							key={detail}
							className="cursor-text select-text text-xs text-amber-600"
						>
							• {detail}
						</li>
					))}
				</ul>
			) : null}

			{status.config && status.config.groundingLayers.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{status.config.groundingLayers.map((layer) => (
						<span
							key={layer}
							className="cursor-text select-text rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
						>
							{layer}
						</span>
					))}
				</div>
			) : null}

			<div className="flex items-center gap-2">
				{status.configured ? (
					<Button
						size="xs"
						variant="secondary"
						onClick={refresh}
						disabled={isRefreshing}
					>
						<LuRefreshCw className="size-3.5" />
						{isRefreshing ? "Refreshing…" : "Refresh context"}
					</Button>
				) : (
					<Button size="xs" onClick={setUp} disabled={isSettingUp}>
						<LuShieldCheck className="size-3.5" />
						{isSettingUp ? "Setting up…" : "Set up AI reviewer"}
					</Button>
				)}
			</div>
		</div>
	);
}
