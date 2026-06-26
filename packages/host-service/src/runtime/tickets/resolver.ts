import type {
	ResolvedTickets,
	TicketSource,
	UnifiedTicket,
	UnifiedTicketFilter,
} from "./types";

// Wave-7 M3 — the active-source resolution. Cloud-precedence: cloud wins, so
// when a cloud Linear connection is active it is the SOLE source; the local
// source is surfaced only when cloud is disconnected. There is NO cross-source
// merge in v1 (single active source). Composition is read-time: this calls the
// source adapters fresh each read and never persists.

/** Pure precedence rule: cloud > local > none. */
export function resolveActiveSource({
	cloudConnected,
	localConnected,
}: {
	cloudConnected: boolean;
	localConnected: boolean;
}): TicketSource | null {
	if (cloudConnected) return "cloud";
	if (localConnected) return "local";
	return null;
}

export interface ResolveActiveTicketsDeps {
	/** Cloud-precedence gate: true when a cloud Linear connection is active. */
	isCloudConnected: () => boolean | Promise<boolean>;
	/** True when the host-local Linear connection has a stored token. */
	isLocalConnected: () => boolean | Promise<boolean>;
	/** Cloud source adapter (fetch + normalize Linear-synced `tasks`). */
	listCloudTickets: () => UnifiedTicket[] | Promise<UnifiedTicket[]>;
	/** Local source adapter (read + normalize the M2 `linear_tickets` cache). */
	listLocalTickets: (
		filter: UnifiedTicketFilter,
	) => UnifiedTicket[] | Promise<UnifiedTicket[]>;
	/** Read-time filter (local-only `teamId` in v1). */
	filter?: UnifiedTicketFilter;
}

/**
 * Resolve the single active source and return its unified tickets, tagged with
 * `source`. Cloud-precedence short-circuits the local check entirely (we never
 * even probe local while cloud is active). Returns `{ source: null, tickets: [] }`
 * when NEITHER connection is active.
 */
export async function resolveActiveTickets(
	deps: ResolveActiveTicketsDeps,
): Promise<ResolvedTickets> {
	const cloudConnected = await deps.isCloudConnected();
	// Cloud-precedence: don't probe local at all while cloud is active.
	const localConnected = cloudConnected ? false : await deps.isLocalConnected();
	const source = resolveActiveSource({ cloudConnected, localConnected });

	if (source === "cloud") {
		return { source, tickets: await deps.listCloudTickets() };
	}
	if (source === "local") {
		return { source, tickets: await deps.listLocalTickets(deps.filter ?? {}) };
	}
	return { source: null, tickets: [] };
}
