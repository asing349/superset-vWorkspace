import { resolveActiveSource, resolveActiveTickets } from "./resolver";
import type {
	ResolvedTickets,
	TicketSource,
	UnifiedTicket,
	UnifiedTicketFilter,
} from "./types";

// Wave-7 M3 — the host `tickets.*` runtime. A thin, INJECTED wrapper around the
// pure resolver: it owns no state and persists nothing, resolving the active
// source on every read (cloud-precedence). Wired in `app.ts` with the cloud API
// client + the M1 local-auth store + the M2 local ticket cache. All four deps
// are injected so tests run against fakes (no live cloud API, no real store).

export interface TicketsRuntimeDeps {
	/** Cloud-precedence gate: true when a cloud Linear connection is active. */
	isCloudConnected: () => boolean | Promise<boolean>;
	/** True when the host-local Linear connection has a stored token. */
	isLocalConnected: () => boolean | Promise<boolean>;
	/** Cloud source: fetch + normalize the Linear-synced cloud `tasks`. */
	listCloudTickets: () => UnifiedTicket[] | Promise<UnifiedTicket[]>;
	/** Local source: read + normalize the M2 `linear_tickets` cache. */
	listLocalTickets: (
		filter: UnifiedTicketFilter,
	) => UnifiedTicket[] | Promise<UnifiedTicket[]>;
}

export class TicketsRuntime {
	private readonly deps: TicketsRuntimeDeps;

	constructor(deps: TicketsRuntimeDeps) {
		this.deps = deps;
	}

	/** Resolve the active source and return its unified, source-tagged tickets. */
	list(filter: UnifiedTicketFilter = {}): Promise<ResolvedTickets> {
		return resolveActiveTickets({
			isCloudConnected: this.deps.isCloudConnected,
			isLocalConnected: this.deps.isLocalConnected,
			listCloudTickets: this.deps.listCloudTickets,
			listLocalTickets: this.deps.listLocalTickets,
			filter,
		});
	}

	/**
	 * The currently-active source (`"cloud"` | `"local"` | `null`) WITHOUT
	 * fetching any tickets — a cheap connection-status check for the UI to badge.
	 */
	async activeSource(): Promise<TicketSource | null> {
		const cloudConnected = await this.deps.isCloudConnected();
		const localConnected = cloudConnected
			? false
			: await this.deps.isLocalConnected();
		return resolveActiveSource({ cloudConnected, localConnected });
	}
}
