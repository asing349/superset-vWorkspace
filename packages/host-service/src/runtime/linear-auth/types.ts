// Wave-7 M1 — shared types for the host-local Linear connection.

export interface LinearViewer {
	id: string;
	name: string;
	email?: string;
}

export interface LinearWorkspace {
	id: string;
	name: string;
}

/**
 * The status surfaced to the renderer. NOTE: this is the redaction boundary —
 * it intentionally carries NO token material. `getConnection` returns exactly
 * this shape.
 */
export interface LinearLocalConnectionStatus {
	connected: boolean;
	viewer?: string;
	workspace?: string;
	/** Epoch ms at which the access token expires (when known). */
	expiresAt?: number;
}

/**
 * Host-internal decrypted token bundle. Returned only to in-process callers
 * (refresh, the M2 poller) — NEVER serialized over tRPC.
 */
export interface StoredLinearAuth {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
	scope: string | null;
	viewer: LinearViewer | null;
	workspace: LinearWorkspace | null;
}

export interface SaveLinearAuthInput {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
	scope: string | null;
	viewer: LinearViewer | null;
	workspace: LinearWorkspace | null;
}
