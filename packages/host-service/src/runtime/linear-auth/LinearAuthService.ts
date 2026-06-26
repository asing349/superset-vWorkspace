import { z } from "zod";
import {
	DEFAULT_REDIRECT_HOST,
	DEFAULT_REDIRECT_PATH,
	DEFAULT_REDIRECT_PORT,
	LINEAR_AUTHORIZE_URL,
	LINEAR_GRAPHQL_URL,
	LINEAR_OAUTH_SCOPES,
	LINEAR_REFRESH_BUFFER_MS,
	LINEAR_REQUEST_TIMEOUT_MS,
	LINEAR_TOKEN_URL,
} from "./constants";
import { HttpLinearOAuthLoopback, type LinearOAuthLoopback } from "./loopback";
import { generateOAuthState, generatePkcePair, type PkcePair } from "./pkce";
import type { LinearLocalAuthStore } from "./store";
import type {
	LinearLocalConnectionStatus,
	LinearViewer,
	LinearWorkspace,
} from "./types";

// Wave-7 M1 — host-side, one-button PKCE Linear connect (no client secret),
// gated by cloud-precedence, with the token stored encrypted host-local.
// Mirrors the desktop's host-side Anthropic/OpenAI OAuth services: the host
// returns an authorize URL (the renderer opens the system browser) and arms a
// loopback listener that captures the redirect; `completeConnect` exchanges the
// code with the replayed `code_verifier` and stores the tokens encrypted.

const tokenResponseSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string().optional(),
	expires_in: z.number().optional(),
	token_type: z.string().optional(),
	scope: z.string().optional(),
});

const viewerResponseSchema = z.object({
	data: z
		.object({
			viewer: z
				.object({
					id: z.string(),
					name: z.string(),
					email: z.string().optional(),
				})
				.nullish(),
			organization: z.object({ id: z.string(), name: z.string() }).nullish(),
		})
		.nullish(),
});

interface RedirectTarget {
	host: string;
	port: number;
	path: string;
}

export interface LinearAuthServiceDeps {
	store: LinearLocalAuthStore;
	/** Cloud-precedence gate: resolves true when a cloud Linear conn is active. */
	checkCloudConnected: () => Promise<boolean>;
	/** Public desktop client id (LINEAR_DESKTOP_CLIENT_ID). Undefined → no live connect. */
	clientId?: string;
	redirect?: Partial<RedirectTarget>;
	fetchFn?: typeof fetch;
	createLoopback?: () => LinearOAuthLoopback;
	generatePkce?: () => PkcePair;
	generateState?: () => string;
	now?: () => number;
}

interface PendingAttempt {
	verifier: string;
	state: string;
	redirectUri: string;
}

export interface StartConnectResult {
	url: string;
	instructions: string;
}

const CLOUD_PRECEDENCE_MESSAGE =
	"A cloud Linear connection is active. Disconnect cloud Linear to connect this Mac.";
const MISSING_CLIENT_ID_MESSAGE =
	"LINEAR_DESKTOP_CLIENT_ID is not set. A public Linear OAuth client id is required to connect Linear for this Mac.";

export class LinearAuthService {
	private readonly store: LinearLocalAuthStore;
	private readonly checkCloudConnected: () => Promise<boolean>;
	private readonly clientId: string | undefined;
	private readonly redirect: RedirectTarget;
	private readonly fetchFn: typeof fetch;
	private readonly createLoopback: () => LinearOAuthLoopback;
	private readonly generatePkce: () => PkcePair;
	private readonly generateState: () => string;
	private readonly now: () => number;

	private pendingAttempt: PendingAttempt | null = null;
	private loopback: LinearOAuthLoopback | null = null;
	private pendingCallbackCode: string | null = null;

	constructor(deps: LinearAuthServiceDeps) {
		this.store = deps.store;
		this.checkCloudConnected = deps.checkCloudConnected;
		this.clientId = deps.clientId;
		this.redirect = {
			host: deps.redirect?.host ?? DEFAULT_REDIRECT_HOST,
			port: deps.redirect?.port ?? DEFAULT_REDIRECT_PORT,
			path: deps.redirect?.path ?? DEFAULT_REDIRECT_PATH,
		};
		this.fetchFn = deps.fetchFn ?? fetch;
		this.createLoopback =
			deps.createLoopback ?? (() => new HttpLinearOAuthLoopback());
		this.generatePkce = deps.generatePkce ?? generatePkcePair;
		this.generateState = deps.generateState ?? generateOAuthState;
		this.now = deps.now ?? (() => Date.now());
	}

	/** Status only — NEVER returns token material (redaction boundary). */
	getConnection(): LinearLocalConnectionStatus {
		return this.store.getStatus();
	}

	/**
	 * Begin the one-button PKCE connect. Refuses (cloud-precedence) when a cloud
	 * Linear connection is active. Builds the authorize URL and arms the
	 * loopback redirect capture; the renderer opens the returned URL.
	 */
	async startConnect(): Promise<StartConnectResult> {
		if (await this.checkCloudConnected()) {
			throw new Error(CLOUD_PRECEDENCE_MESSAGE);
		}
		const clientId = this.requireClientId();

		// One attempt at a time — tear down any previous loopback/attempt.
		this.stopLoopback();
		this.pendingCallbackCode = null;

		const pkce = this.generatePkce();
		const state = this.generateState();
		const redirectUri = `http://${this.redirect.host}:${this.redirect.port}${this.redirect.path}`;

		const authorizeUrl = new URL(LINEAR_AUTHORIZE_URL);
		authorizeUrl.searchParams.set("client_id", clientId);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("scope", LINEAR_OAUTH_SCOPES);
		authorizeUrl.searchParams.set("state", state);
		authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
		authorizeUrl.searchParams.set("code_challenge_method", pkce.method);

		this.pendingAttempt = { verifier: pkce.verifier, state, redirectUri };

		await this.armLoopback(state);

		return {
			url: authorizeUrl.toString(),
			instructions:
				"Authorize Linear in your browser. If the callback doesn't complete automatically, paste the code shown there here.",
		};
	}

	/**
	 * Renderer poll hook: returns + clears the code captured by the loopback,
	 * mirroring `consumeOpenAIOAuthCallback`. The renderer then calls
	 * `completeConnect({ code })`.
	 */
	consumeCallback(): { code: string | null } {
		const code = this.pendingCallbackCode;
		this.pendingCallbackCode = null;
		return { code };
	}

	/**
	 * Exchange the authorization code for tokens (PKCE; `code_verifier`, NO
	 * `client_secret`) and store them encrypted host-local.
	 */
	async completeConnect(input: {
		code: string;
	}): Promise<LinearLocalConnectionStatus> {
		const attempt = this.pendingAttempt;
		if (!attempt) {
			throw new Error(
				"No Linear connection is in progress. Start the connection again.",
			);
		}
		const clientId = this.requireClientId();

		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: input.code,
			client_id: clientId,
			redirect_uri: attempt.redirectUri,
			code_verifier: attempt.verifier,
		});

		const token = await this.postToken(body);
		const viewer = await this.fetchViewer(token.access_token);

		this.store.save({
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? null,
			expiresAt: token.expires_in ? this.now() + token.expires_in * 1000 : null,
			scope: token.scope ?? null,
			viewer: viewer.viewer,
			workspace: viewer.workspace,
		});

		this.stopLoopback();
		this.pendingAttempt = null;
		this.pendingCallbackCode = null;
		return this.store.getStatus();
	}

	/** Abort an in-progress connect (renderer dialog dismissal). */
	cancelConnect(): { success: true } {
		this.stopLoopback();
		this.pendingAttempt = null;
		this.pendingCallbackCode = null;
		return { success: true };
	}

	/** Purge the local token. */
	disconnect(): { success: true } {
		this.stopLoopback();
		this.pendingAttempt = null;
		this.pendingCallbackCode = null;
		this.store.clear();
		return { success: true };
	}

	/**
	 * Lazy PKCE refresh (`grant_type=refresh_token`, NO secret) when the access
	 * token is within the refresh buffer of expiry. A no-op when not connected,
	 * not near expiry, or lacking a refresh token. On `invalid_grant` the local
	 * token is purged so the UI re-prompts a one-button connect.
	 */
	async refresh(): Promise<LinearLocalConnectionStatus> {
		const stored = this.store.getStored();
		if (!stored) return { connected: false };
		if (!stored.refreshToken) return this.store.getStatus();

		const notNearExpiry =
			stored.expiresAt !== null &&
			stored.expiresAt - this.now() > LINEAR_REFRESH_BUFFER_MS;
		if (notNearExpiry) return this.store.getStatus();

		const clientId = this.requireClientId();
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: stored.refreshToken,
			client_id: clientId,
		});

		const response = await this.fetchWithTimeout(LINEAR_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});

		if (!response.ok) {
			const errorBody = (await response.json().catch(() => ({}))) as {
				error?: string;
			};
			if (errorBody.error === "invalid_grant") {
				this.store.clear();
				return { connected: false };
			}
			throw new Error(
				`Linear token refresh failed: ${response.status} ${response.statusText}`,
			);
		}

		const token = tokenResponseSchema.parse(await response.json());
		this.store.save({
			accessToken: token.access_token,
			refreshToken: token.refresh_token ?? stored.refreshToken,
			expiresAt: token.expires_in ? this.now() + token.expires_in * 1000 : null,
			scope: token.scope ?? stored.scope,
			viewer: stored.viewer,
			workspace: stored.workspace,
		});
		return this.store.getStatus();
	}

	private requireClientId(): string {
		if (!this.clientId) throw new Error(MISSING_CLIENT_ID_MESSAGE);
		return this.clientId;
	}

	private async postToken(
		body: URLSearchParams,
	): Promise<z.infer<typeof tokenResponseSchema>> {
		const response = await this.fetchWithTimeout(LINEAR_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		if (!response.ok) {
			throw new Error(
				`Linear token exchange failed: ${response.status} ${response.statusText}`,
			);
		}
		return tokenResponseSchema.parse(await response.json());
	}

	/**
	 * Best-effort fetch of the viewer + workspace for the status card. A failure
	 * here must NOT fail the connect (the token is already valid), so we degrade
	 * to a connection with no display name.
	 */
	private async fetchViewer(accessToken: string): Promise<{
		viewer: LinearViewer | null;
		workspace: LinearWorkspace | null;
	}> {
		try {
			const response = await this.fetchWithTimeout(LINEAR_GRAPHQL_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({
					query: "query { viewer { id name email } organization { id name } }",
				}),
			});
			if (!response.ok) return { viewer: null, workspace: null };
			const parsed = viewerResponseSchema.parse(await response.json());
			const viewerNode = parsed.data?.viewer;
			const orgNode = parsed.data?.organization;
			return {
				viewer: viewerNode
					? {
							id: viewerNode.id,
							name: viewerNode.name,
							email: viewerNode.email,
						}
					: null,
				workspace: orgNode ? { id: orgNode.id, name: orgNode.name } : null,
			};
		} catch {
			return { viewer: null, workspace: null };
		}
	}

	private async armLoopback(state: string): Promise<void> {
		const loopback = this.createLoopback();
		try {
			await loopback.start({
				host: this.redirect.host,
				port: this.redirect.port,
				path: this.redirect.path,
				onCallback: (result) => {
					// Ignore a redirect whose state doesn't match this attempt.
					if (result.state !== null && result.state !== state) return;
					this.pendingCallbackCode = result.code;
				},
			});
			this.loopback = loopback;
		} catch (error) {
			// Port unavailable or other bind failure — fall back to manual paste.
			loopback.stop();
			console.warn(
				"[linear-auth] loopback redirect capture unavailable; manual paste fallback:",
				error instanceof Error ? error.message : error,
			);
		}
	}

	private stopLoopback(): void {
		if (this.loopback) {
			this.loopback.stop();
			this.loopback = null;
		}
	}

	private async fetchWithTimeout(
		url: string,
		init: RequestInit,
	): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			LINEAR_REQUEST_TIMEOUT_MS,
		);
		try {
			return await this.fetchFn(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timeout);
		}
	}
}
