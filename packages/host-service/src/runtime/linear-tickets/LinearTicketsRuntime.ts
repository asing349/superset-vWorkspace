import type { LinearTicketClientFactory } from "./client";
import type { LinearTicketsStore } from "./store";
import type {
	LinearTeam,
	LocalLinearTicket,
	PollResult,
	TicketFilter,
} from "./types";

// Wave-7 M2 — host runtime poller for the local Linear connection. When a local
// token is present it fetches the viewer's issues (assigned-to-me /
// created-by-me) on an interval and upserts them into the host-local
// `linear_tickets` store, emitting a `change` to any subscribers. With NO local
// token it is a strict no-op: it never constructs a client, never hits the
// network, and never logs the token. No webhooks — interval poll + manual
// `refresh()`. NOTHING is written to the cloud DB.

const DEFAULT_POLL_INTERVAL_MS = 45_000;

/** The minimal auth surface the poller needs (M1's store satisfies this). */
export interface TicketAuthTokenSource {
	/** Decrypted access token, or null when not connected. Host-internal only. */
	getAccessToken(): string | null;
}

export interface LinearTicketsRuntimeDeps {
	store: LinearTicketsStore;
	/** Host-internal access-token source (M1 `LinearLocalAuthStore`). */
	auth: TicketAuthTokenSource;
	/** Builds a Linear client from the access token (real SDK or a test fake). */
	createClient: LinearTicketClientFactory;
	/**
	 * Optional lazy token-refresh run before each poll (M1 `linearAuth.refresh`).
	 * Best-effort: a throw here never aborts the poll.
	 */
	ensureFreshToken?: () => Promise<void>;
	/** Poll cadence; default 45s. */
	intervalMs?: number;
	now?: () => number;
}

type ChangeListener = () => void;

export class LinearTicketsRuntime {
	private readonly store: LinearTicketsStore;
	private readonly auth: TicketAuthTokenSource;
	private readonly createClient: LinearTicketClientFactory;
	private readonly ensureFreshToken?: () => Promise<void>;
	private readonly intervalMs: number;
	private readonly now: () => number;

	private timer: ReturnType<typeof setInterval> | null = null;
	private inFlight: Promise<PollResult> | null = null;
	private readonly changeListeners = new Set<ChangeListener>();

	constructor(deps: LinearTicketsRuntimeDeps) {
		this.store = deps.store;
		this.auth = deps.auth;
		this.createClient = deps.createClient;
		this.ensureFreshToken = deps.ensureFreshToken;
		this.intervalMs = deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.now = deps.now ?? (() => Date.now());
	}

	/** Begin interval polling. Idempotent. Kicks one immediate (token-gated) poll. */
	start(): void {
		if (this.timer) return;
		// Immediate first poll so a freshly-connected user sees tickets without
		// waiting a full interval. A no-op when no local token is present.
		void this.poll();
		this.timer = setInterval(() => {
			void this.poll();
		}, this.intervalMs);
	}

	/** Stop interval polling. Idempotent. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Poll Linear once and upsert. Coalesces concurrent polls (interval tick +
	 * manual refresh) so the same fetch never runs twice in parallel. Resolves to
	 * `{ polled: false, count: 0 }` when there is no local token (strict no-op).
	 */
	poll(): Promise<PollResult> {
		if (this.inFlight) return this.inFlight;
		this.inFlight = this.runPoll().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	/** Manual Refresh — polls now and returns the result. */
	refresh(): Promise<PollResult> {
		return this.poll();
	}

	/** List cached tickets (optional team filter). */
	list(filter: TicketFilter = {}): LocalLinearTicket[] {
		return this.store.list(filter);
	}

	/** Fetch the Linear teams for the picker. Returns `[]` when no local token. */
	async getTeams(): Promise<LinearTeam[]> {
		const token = await this.resolveToken();
		if (!token) return [];
		const client = this.createClient({ accessToken: token });
		return client.fetchTeams();
	}

	/** Subscribe to upsert events; returns an unsubscribe. */
	onChange(listener: ChangeListener): () => void {
		this.changeListeners.add(listener);
		return () => {
			this.changeListeners.delete(listener);
		};
	}

	private async runPoll(): Promise<PollResult> {
		const token = await this.resolveToken();
		// No local token → strict no-op (never builds a client or hits network).
		if (!token) return { polled: false, count: 0 };

		try {
			const client = this.createClient({ accessToken: token });
			const issues = await client.fetchIssues({});
			const count = this.store.upsertMany({ issues, now: this.now() });
			this.emitChange();
			return { polled: true, count };
		} catch (error) {
			// Never crash the interval; never log the token.
			console.warn(
				"[linear-tickets] poll failed:",
				error instanceof Error ? error.message : error,
			);
			return { polled: true, count: 0 };
		}
	}

	private async resolveToken(): Promise<string | null> {
		if (this.ensureFreshToken) {
			try {
				await this.ensureFreshToken();
			} catch (error) {
				console.warn(
					"[linear-tickets] token refresh failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}
		return this.auth.getAccessToken();
	}

	private emitChange(): void {
		for (const listener of this.changeListeners) {
			try {
				listener();
			} catch (error) {
				console.warn(
					"[linear-tickets] change listener threw:",
					error instanceof Error ? error.message : error,
				);
			}
		}
	}
}
