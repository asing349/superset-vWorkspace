import {
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { GitPullRequest } from "lucide-react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { PR_FILTER_OPTIONS, type PrListFilter } from "./constants";

interface PullRequestsSubmenuProps {
	/** v2 project whose repo PRs are listed (`workspace.projectId`). */
	projectId: string;
	/** Open the selected PR in a review window. */
	onOpenPullRequest: (prNumber: number) => void;
}

/**
 * The "Pull Requests" list (Wave 5, M2): the repo's PRs, each a one-click
 * "open in review window" action. Lives in the AddTabMenu alongside Memory —
 * the same opener pattern — as a submenu so the list doesn't crowd the
 * top-level menu.
 *
 * Wave 6, M2 adds filter chips (a radio group): **All** the repo's PRs,
 * **Created by me** (`author:@me`), or **Review-requested · Tagged** (the union
 * of `review-requested:@me` / `assignee:@me` / `mentions:@me`). The chips
 * `preventDefault` on select so switching filters keeps the submenu open.
 *
 * Source: the Electron-main `projects.listFilteredPullRequests` (`gh pr list
 * [--search]` for the project's repo) — project-scoped, matching
 * `prReview.getDiff({ projectId, prNumber })`. Read-only. Cache-first: rows
 * render from `data` as soon as they arrive; a gh/auth failure degrades to
 * "No pull requests" rather than erroring.
 */
export function PullRequestsSubmenu({
	projectId,
	onOpenPullRequest,
}: PullRequestsSubmenuProps) {
	const [filter, setFilter] = useState<PrListFilter>("all");

	const prsQuery = electronTrpc.projects.listFilteredPullRequests.useQuery(
		{ projectId, filter, includeClosed: true },
		{ staleTime: 30_000, enabled: Boolean(projectId) },
	);
	const pullRequests = prsQuery.data ?? [];

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="gap-2">
				<GitPullRequest className="size-4" />
				<span>Pull Requests</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-96 w-80 overflow-y-auto">
				<DropdownMenuRadioGroup
					value={filter}
					onValueChange={(value) => setFilter(value as PrListFilter)}
				>
					{PR_FILTER_OPTIONS.map((option) => (
						<DropdownMenuRadioItem
							key={option.value}
							value={option.value}
							// Keep the submenu open while switching filters.
							onSelect={(event) => event.preventDefault()}
						>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
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
