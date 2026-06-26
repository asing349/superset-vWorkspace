import { Button } from "@superset/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { ticketSourceLabel } from "./ticketSourceLabel";

// Wave-7 M3 — source-agnostic ticket list. Reads the host `tickets.list`
// surface, which resolves THE SINGLE ACTIVE SOURCE at read time under
// cloud-precedence (cloud Linear-synced tasks when a cloud connection is active,
// else the host-local Linear cache, else nothing) and tags each ticket with its
// `source`. This view is source-blind: it badges each row "Cloud" / "This Mac"
// and otherwise renders identically regardless of source. The renderer
// host-service tRPC client is httpLink-only (no subscriptions), so this reads on
// a refetch interval (poll-based stream) plus a manual Refresh — and follows the
// cache-first rule: existing rows stay rendered while a refetch is in flight.

const TICKETS_REFETCH_INTERVAL_MS = 15_000;

interface IntegrationTicketsProps {
	/** Active local host-service URL. */
	hostUrl: string;
}

export function IntegrationTickets({ hostUrl }: IntegrationTicketsProps) {
	const queryClient = useQueryClient();
	const [teamId, setTeamId] = useState<string | undefined>(undefined);

	const ticketsKey = ["unified-tickets", hostUrl, teamId ?? null] as const;

	const ticketsQuery = useQuery({
		queryKey: ticketsKey,
		refetchInterval: TICKETS_REFETCH_INTERVAL_MS,
		refetchOnWindowFocus: false,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).tickets.list.query(
				teamId ? { teamId } : undefined,
			),
	});

	const source = ticketsQuery.data?.source ?? null;
	const tickets = ticketsQuery.data?.tickets ?? [];
	const isLocalActive = source === "local";

	// Teams come from the host-local Linear connection, so only fetch them when
	// the active source is local (the team filter narrows local tickets only).
	const teamsQuery = useQuery({
		queryKey: ["unified-tickets-teams", hostUrl] as const,
		enabled: isLocalActive,
		refetchOnWindowFocus: false,
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).linear.tickets.teams.query(),
	});

	const refreshMutation = useMutation({
		// Source-blind refresh: `linear.tickets.refresh` re-polls the local source
		// (a strict no-op without a local token, so it's safe when cloud is active),
		// then we re-read the unified list.
		mutationFn: () =>
			getHostServiceClientByUrl(hostUrl).linear.tickets.refresh.mutate(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ticketsKey });
		},
	});

	const handleTeamChange = useCallback((value: string) => {
		setTeamId(value === "" ? undefined : value);
	}, []);

	const teams = teamsQuery.data ?? [];

	return (
		<div className="mt-3 pl-11 pr-0">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<span>Tickets ({tickets.length})</span>
					{source && (
						<span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
							{ticketSourceLabel(source)}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{isLocalActive && (
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
					)}
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
					{source === null
						? "Connect Linear (cloud or this Mac) to see tickets."
						: "No tickets yet. Click Refresh to sync."}
				</div>
			) : (
				<ul className="mt-2 flex flex-col gap-1">
					{tickets.map((ticket) => (
						<li
							key={ticket.unifiedId}
							className="flex items-center gap-2 text-xs min-w-0"
						>
							<span className="shrink-0 rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
								{ticketSourceLabel(ticket.source)}
							</span>
							<span className="font-mono text-muted-foreground shrink-0">
								{ticket.identifier}
							</span>
							{ticket.url ? (
								<a
									href={ticket.url}
									target="_blank"
									rel="noreferrer"
									className="truncate hover:underline"
									title={ticket.title}
								>
									{ticket.title}
								</a>
							) : (
								<span className="truncate" title={ticket.title}>
									{ticket.title}
								</span>
							)}
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
