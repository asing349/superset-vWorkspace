// Wave-7 M5 — pure UI-state helpers for the host-local Linear connection card.
//
// These mirror (but never duplicate the authority of) the host-side
// cloud-precedence gate + token store. The host remains the source of truth:
// `startConnect` refuses while cloud is active, and the store reports the
// connection status (including `expiresAt`). These helpers only map that status
// onto the card's affordances so the precedence rule and the expired→reconnect
// prompt are explicit, deterministic, and unit-testable without a live OAuth app.

/**
 * The redaction-safe status the host `linear.auth.getConnection` returns. Mirrors
 * the host `LinearLocalConnectionStatus` — NO token material ever crosses here.
 */
export interface LinearLocalConnectionStatus {
	connected: boolean;
	viewer?: string;
	workspace?: string;
	/** Epoch ms at which the local access token expires (when known). */
	expiresAt?: number;
}

/**
 * The high-level state of the local connection from the renderer's POV:
 *  - `disconnected` — no local token; offer connect (precedence permitting).
 *  - `connected` — a live local token (not past expiry).
 *  - `expired` — a stored local token whose access token is past expiry; the
 *    host's lazy refresh could not (or has not) renewed it, so prompt a
 *    one-button re-connect.
 */
export type LinearLocalStatus = "disconnected" | "connected" | "expired";

/**
 * Map the host connection status (+ the current time) onto the card state.
 * Pure + `now`-injected so it is deterministic in tests. `expired` requires a
 * known `expiresAt` at or before `now`; an unknown expiry is treated as live
 * (the host only surfaces `expiresAt` when Linear returned `expires_in`).
 */
export function deriveLinearLocalStatus({
	connection,
	now,
}: {
	connection: LinearLocalConnectionStatus | undefined | null;
	now: number;
}): LinearLocalStatus {
	if (!connection?.connected) return "disconnected";
	if (connection.expiresAt !== undefined && connection.expiresAt <= now) {
		return "expired";
	}
	return "connected";
}

/** "Connected as <viewer> (<workspace>)" / "Connected" — never shows a token. */
export function formatLinearLocalStatusLabel({
	connection,
}: {
	connection: LinearLocalConnectionStatus | undefined | null;
}): string {
	if (!connection?.viewer) return "Connected";
	return connection.workspace
		? `Connected as ${connection.viewer} (${connection.workspace})`
		: `Connected as ${connection.viewer}`;
}

/** Whether this local connection is the active source (cloud-precedence). */
export function isLocalActiveSource({
	cloudConnected,
	localStatus,
}: {
	cloudConnected: boolean;
	localStatus: LinearLocalStatus;
}): boolean {
	return !cloudConnected && localStatus === "connected";
}

export interface LocalConnectAffordance {
	/** Whether the connect/reconnect control must be disabled. */
	disabled: boolean;
	/** A human explainer for the disabled state, or null when enabled. */
	reason: string | null;
}

/**
 * Cloud-precedence + readiness gate for the connect/reconnect control. Cloud
 * always wins: while a cloud Linear connection is active the local control is
 * disabled with the canonical explainer (this matches the host gate, which
 * refuses `startConnect`). Otherwise it is disabled only when the host service
 * is unavailable or a connect is already in flight.
 */
export function deriveLocalConnectAffordance({
	cloudConnected,
	busy,
	hostAvailable,
}: {
	cloudConnected: boolean;
	busy: boolean;
	hostAvailable: boolean;
}): LocalConnectAffordance {
	if (cloudConnected) {
		return {
			disabled: true,
			reason: "Disconnect cloud Linear to connect this Mac.",
		};
	}
	if (!hostAvailable) {
		return { disabled: true, reason: "Host service is not running." };
	}
	if (busy) return { disabled: true, reason: null };
	return { disabled: false, reason: null };
}
