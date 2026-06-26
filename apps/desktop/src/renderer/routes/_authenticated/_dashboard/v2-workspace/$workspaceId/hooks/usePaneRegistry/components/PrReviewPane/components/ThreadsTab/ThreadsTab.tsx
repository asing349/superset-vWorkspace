import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { LuCheck, LuMessageSquare } from "react-icons/lu";
import type { UseReviewThreadsResult } from "../../hooks/useReviewThreads";
import type { ReviewThread } from "../../types";

interface ThreadsTabProps {
	threadsState: UseReviewThreadsResult;
}

/**
 * The Threads tab of the PR-review window (Wave 6, M4).
 *
 * Read-only display of the PR's EXISTING GitHub review threads (via the
 * generalised `git.getPullRequestThreads`), ordered actionable-first. Each thread
 * can be resolved / unresolved in place — an explicit per-thread click that calls
 * `git.setReviewThreadResolution`; the reviewer never resolves on its own and
 * there is no bulk action. Posting NEW comments stays the M3 Findings flow; this
 * tab only reads + toggles resolution on what's already there.
 */
export function ThreadsTab({ threadsState }: ThreadsTabProps) {
	const {
		threads,
		isLoading,
		isUnavailable,
		toggleResolved,
		togglingThreadId,
	} = threadsState;

	if (isUnavailable) {
		return (
			<div className="flex h-full w-full cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
				Review threads are unavailable — this PR's GitHub location couldn't be
				resolved.
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-full w-full cursor-text select-text items-center justify-center text-sm text-muted-foreground">
				Loading review threads…
			</div>
		);
	}

	if (threads.length === 0) {
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
				<LuMessageSquare className="size-8 text-muted-foreground" />
				<p className="cursor-text select-text text-sm text-muted-foreground">
					No review threads on this PR yet.
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<ul className="flex flex-col gap-3 p-3">
					{threads.map((thread) => (
						<ThreadCard
							key={thread.id}
							thread={thread}
							isToggling={togglingThreadId === thread.id}
							onToggle={() =>
								toggleResolved({
									threadId: thread.id,
									resolved: !thread.isResolved,
								})
							}
						/>
					))}
				</ul>
			</div>
		</div>
	);
}

/**
 * A single review thread (Wave 6, M4): its anchor (path:line), resolution badge,
 * the comments in order, and an explicit resolve / unresolve toggle. The comment
 * bodies come straight from GitHub (already-public PR content), so they render
 * verbatim — selectable for copy.
 */
function ThreadCard({
	thread,
	onToggle,
	isToggling,
}: {
	thread: ReviewThread;
	onToggle: () => void;
	isToggling: boolean;
}) {
	const anchor =
		thread.line != null ? `${thread.path}:${thread.line}` : thread.path;
	return (
		<li
			className={cn(
				"rounded border border-border bg-muted/20",
				thread.isResolved && "opacity-70",
			)}
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
				<span
					className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
					title={anchor || undefined}
				>
					{anchor || "Conversation"}
				</span>
				{thread.isResolved ? (
					<span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
						<LuCheck className="size-3" />
						Resolved
					</span>
				) : null}
				{thread.isOutdated ? (
					<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						Outdated
					</span>
				) : null}
				<Button
					size="xs"
					variant={thread.isResolved ? "ghost" : "secondary"}
					className="h-auto shrink-0 px-2 py-0.5 text-[11px]"
					disabled={isToggling}
					onClick={onToggle}
				>
					{isToggling
						? "Updating…"
						: thread.isResolved
							? "Unresolve"
							: "Resolve"}
				</Button>
			</div>
			<ul className="flex flex-col gap-2 px-3 py-2">
				{thread.comments.map((comment) => (
					<li key={comment.id} className="text-sm">
						<div className="flex items-center gap-2">
							<span className="cursor-text select-text text-xs font-medium text-foreground">
								{comment.author.login}
							</span>
						</div>
						<p className="cursor-text select-text whitespace-pre-wrap break-words text-xs text-muted-foreground">
							{comment.body}
						</p>
					</li>
				))}
			</ul>
		</li>
	);
}
