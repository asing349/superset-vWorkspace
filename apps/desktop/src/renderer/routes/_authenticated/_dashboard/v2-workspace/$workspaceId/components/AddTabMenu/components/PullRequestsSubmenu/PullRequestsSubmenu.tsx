import {
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { GitPullRequest } from "lucide-react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface PullRequestsSubmenuProps {
	/** v2 project whose repo PRs are listed (`workspace.projectId`). */
	projectId: string;
	/** Open the selected PR in a review window. */
	onOpenPullRequest: (prNumber: number) => void;
}

/**
 * The "Pull Requests" list (Wave 5, M2): ALL of the repo's PRs (open + closed),
 * each a one-click "open in review window" action. Lives in the AddTabMenu
 * alongside Memory — the same opener pattern — as a submenu so the list doesn't
 * crowd the top-level menu.
 *
 * Source: the Electron-main `projects.listPullRequests` (`gh pr list` for the
 * project's repo) — project-scoped, matching `prReview.getDiff({ projectId,
 * prNumber })`. Cache-first: rows render from `data` as soon as they arrive; a
 * gh/auth failure degrades to "No pull requests" rather than erroring.
 */
export function PullRequestsSubmenu({
	projectId,
	onOpenPullRequest,
}: PullRequestsSubmenuProps) {
	const prsQuery = electronTrpc.projects.listPullRequests.useQuery(
		{ projectId, includeClosed: true },
		{ staleTime: 30_000, enabled: Boolean(projectId) },
	);
	const pullRequests = prsQuery.data ?? [];

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="gap-2">
				<GitPullRequest className="size-4" />
				<span>Pull Requests</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-80 w-80 overflow-y-auto">
				{pullRequests.length > 0 ? (
					pullRequests.map((pr) => (
						<DropdownMenuItem
							key={pr.prNumber}
							className="gap-2"
							onClick={() => onOpenPullRequest(pr.prNumber)}
							title={pr.title}
						>
							<span className="shrink-0 text-xs text-muted-foreground">
								#{pr.prNumber}
							</span>
							<span className="min-w-0 flex-1 truncate text-sm">
								{pr.title}
							</span>
							<span className="shrink-0 text-[10px] uppercase text-muted-foreground">
								{pr.state}
							</span>
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem disabled className="text-muted-foreground">
						{prsQuery.isLoading ? "Loading pull requests…" : "No pull requests"}
					</DropdownMenuItem>
				)}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
