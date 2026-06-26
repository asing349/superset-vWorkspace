import { Button } from "@superset/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

// Wave-7 M2 — minimal surface for the host-local Linear tickets fetched by the
// poller. The renderer's host-service tRPC client is httpLink-only (no
// subscriptions), so this reads `linear.tickets.list` on a refetch interval
// (a poll-based stream) plus a manual Refresh, with a team-filter picker. M3
// unifies the ticket source; this view exists so local tickets are visible.

const TICKETS_REFETCH_INTERVAL_MS = 15_000;

interface LinearLocalTicketsProps {
	/** Active local host-service URL (already known to be connected). */
	hostUrl: string;
	/** Currently-selected team filter (undefined = all teams). */
	teamId: string | undefined;
	onTeamChange: (teamId: string | undefined) => void;
}

export function LinearLocalTickets({
	hostUrl,
	teamId,
	onTeamChange,
}: LinearLocalTicketsProps) {
	const queryClient = useQueryClient();

	const ticketsKey = ["linear-local-tickets", hostUrl, teamId ?? null] as const;
	const teamsKey = ["linear-local-teams", hostUrl] as const;

	const ticketsQuery = useQuery({
		queryKey: ticketsKey,
		refetchInterval: TICKETS_REFETCH_INTERVAL_MS,
		refetchOnWindowFocus: false,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).linear.tickets.list.query(
				teamId ? { teamId } : undefined,
			),
	});

	const teamsQuery = useQuery({
		queryKey: teamsKey,
		refetchOnWindowFocus: false,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).linear.tickets.teams.query(),
	});

	const refreshMutation = useMutation({
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).linear.tickets.refresh.mutate(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ticketsKey });
		},
	});

	const handleTeamChange = useCallback(
		(value: string) => {
			onTeamChange(value === "" ? undefined : value);
		},
		[onTeamChange],
	);

	const tickets = ticketsQuery.data ?? [];
	const teams = teamsQuery.data ?? [];

	return (
		<div className="mt-3 pl-11 pr-0">
			<div className="flex items-center justify-between gap-3">
				<div className="text-xs font-medium text-muted-foreground">
					Local tickets ({tickets.length})
				</div>
				<div className="flex items-center gap-2">
					<select
						aria-label="Filter tickets by team"
						className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
						value={teamId ?? ""}
						onChange={(e) => handleTeamChange(e.target.value)}
					>
						<option value="">All teams</option>
						{teams.map((team) => (
							<option key={team.id} value={team.id}>
								{team.key} · {team.name}
							</option>
						))}
					</select>
					<Button
						variant="outline"
						size="sm"
						disabled={refreshMutation.isPending}
						onClick={() => refreshMutation.mutate()}
					>
						{refreshMutation.isPending ? "Refreshing…" : "Refresh"}
					</Button>
				</div>
			</div>

			{tickets.length === 0 ? (
				<div className="mt-2 text-xs text-muted-foreground">
					No local tickets yet. Click Refresh to poll Linear.
				</div>
			) : (
				<ul className="mt-2 flex flex-col gap-1">
					{tickets.map((ticket) => (
						<li
							key={ticket.id}
							className="flex items-center gap-2 text-xs min-w-0"
						>
							<span className="font-mono text-muted-foreground shrink-0">
								{ticket.identifier}
							</span>
							<a
								href={ticket.url}
								target="_blank"
								rel="noreferrer"
								className="truncate hover:underline"
								title={ticket.title}
							>
								{ticket.title}
							</a>
							{ticket.state.name && (
								<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
									{ticket.state.name}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
