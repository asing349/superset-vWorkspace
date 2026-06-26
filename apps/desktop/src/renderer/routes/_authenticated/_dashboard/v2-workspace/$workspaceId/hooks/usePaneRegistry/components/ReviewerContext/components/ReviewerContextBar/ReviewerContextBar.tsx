import { Button } from "@superset/ui/button";
import { LuRefreshCw, LuShieldCheck } from "react-icons/lu";
import { useReviewerContext } from "../../hooks/useReviewerContext";
import { summarizeReviewerContext } from "../../utils/summarizeReviewerContext";

interface ReviewerContextBarProps {
	/** The v2 project the PR belongs to. */
	projectId: string;
}

/**
 * The per-project reviewer onboarding / refresh bar (Wave 6, M5) shown at the
 * top of the PR-review Findings tab. It SURFACES the reviewer's state without
 * gating the existing Review-PR button:
 *  - not set up → a "Set up AI reviewer" setup card (gated like
 *    `config.shouldShowSetupCard`); on click it snapshots the project's context
 *    and marks the reviewer ready.
 *  - context changed (a listener flagged it stale, or the on-demand diff moved)
 *    → a "Refresh context" affordance showing what changed.
 *  - ready → nothing (keeps the Findings tab clean).
 *
 * Both actions are explicit clicks — onboarding/refresh never run on their own.
 */
export function ReviewerContextBar({ projectId }: ReviewerContextBarProps) {
	const { status, isLoading, setUp, refresh, isSettingUp, isRefreshing } =
		useReviewerContext({ projectId });

	// Cache-first: render nothing while the first read is in flight (avoids a
	// flash of the setup card before the config loads).
	if (isLoading && !status) return null;

	const summary = summarizeReviewerContext(status);
	if (summary.state === "ready") return null;

	if (summary.state === "not-configured") {
		return (
			<div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/30 px-3 py-2">
				<div className="flex items-center gap-2">
					<LuShieldCheck className="size-4 shrink-0 text-muted-foreground" />
					<span className="cursor-text select-text text-xs font-medium text-foreground">
						AI reviewer not set up for this project
					</span>
					<Button
						size="xs"
						className="ml-auto"
						onClick={setUp}
						disabled={isSettingUp}
					>
						{isSettingUp ? "Setting up…" : "Set up AI reviewer"}
					</Button>
				</div>
				<p className="cursor-text select-text text-xs text-muted-foreground">
					{summary.description}
				</p>
			</div>
		);
	}

	// state === "changed"
	return (
		<div className="flex shrink-0 flex-col gap-1 border-b border-border bg-amber-500/5 px-3 py-2">
			<div className="flex items-center gap-2">
				<span className="cursor-text select-text text-xs font-medium text-amber-600">
					Reviewer context changed
				</span>
				<Button
					size="xs"
					variant="secondary"
					className="ml-auto"
					onClick={refresh}
					disabled={isRefreshing}
				>
					<LuRefreshCw className="size-3.5" />
					{isRefreshing ? "Refreshing…" : "Refresh context"}
				</Button>
			</div>
			{summary.changeDetails.length > 0 ? (
				<ul className="flex flex-col gap-0.5">
					{summary.changeDetails.map((detail) => (
						<li
							key={detail}
							className="cursor-text select-text text-xs text-muted-foreground"
						>
							• {detail}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
