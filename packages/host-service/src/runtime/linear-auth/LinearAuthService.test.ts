import { Database as BunDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import { linearLocalAuth } from "../../db/schema";
import { LinearAuthService } from "./LinearAuthService";
import type { LinearOAuthLoopback } from "./loopback";
import { LinearLocalAuthStore } from "./store";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

interface FetchCall {
	url: string;
	body: URLSearchParams | null;
	headers: Record<string, string>;
}

interface TestDb {
	db: HostDb;
	close: () => void;
}

function makeTestDb(): TestDb {
	const dir = mkdtempSync(join(tmpdir(), "linear-auth-test-"));
	const dbPath = join(dir, "host.db");
	const sqlite = new BunDatabase(dbPath, { create: true, readwrite: true });
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return {
		db: db as unknown as HostDb,
		close: () => {
			try {
				sqlite.close();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

function headersToRecord(init?: RequestInit): Record<string, string> {
	const out: Record<string, string> = {};
	const headers = init?.headers;
	if (headers && typeof headers === "object" && !Array.isArray(headers)) {
		for (const [k, v] of Object.entries(headers)) out[k] = String(v);
	}
	return out;
}

/** A fetch fake that records token/graphql calls and returns canned JSON. */
function makeFetchFake(options?: { tokenResponse?: Record<string, unknown> }): {
	fetchFn: typeof fetch;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	const fetchFn = (async (input: unknown, init?: RequestInit) => {
		const url = String(input);
		const rawBody = init?.body;
		const body =
			rawBody instanceof URLSearchParams
				? rawBody
				: typeof rawBody === "string" && url.includes("/oauth/token")
					? new URLSearchParams(rawBody)
					: null;
		calls.push({ url, body, headers: headersToRecord(init) });

		if (url.includes("/oauth/token")) {
			return new Response(
				JSON.stringify(
					options?.tokenResponse ?? {
						access_token: "access-token-123",
						refresh_token: "refresh-token-456",
						expires_in: 3600,
						token_type: "Bearer",
						scope: "read,write,issues:create",
					},
				),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url.includes("/graphql")) {
			return new Response(
				JSON.stringify({
					data: {
						viewer: { id: "u1", name: "Ada Lovelace", email: "ada@x.dev" },
						organization: { id: "org1", name: "Analytical Engines" },
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
	return { fetchFn, calls };
}

const noopLoopback: () => LinearOAuthLoopback = () => ({
	start: async () => {},
	stop: () => {},
});

function buildService(opts: {
	db: HostDb;
	cloudConnected?: boolean;
	clientId?: string;
	fetchFn?: typeof fetch;
	createLoopback?: () => LinearOAuthLoopback;
	now?: () => number;
}) {
	const store = new LinearLocalAuthStore({ db: opts.db });
	const service = new LinearAuthService({
		store,
		checkCloudConnected: async () => opts.cloudConnected ?? false,
		// Use `in` so an explicit `clientId: undefined` is honored (not defaulted).
		clientId: "clientId" in opts ? opts.clientId : "test-client-id",
		fetchFn: opts.fetchFn ?? makeFetchFake().fetchFn,
		createLoopback: opts.createLoopback ?? noopLoopback,
		generatePkce: () => ({
			verifier: "test-verifier",
			challenge: "test-challenge",
			method: "S256",
		}),
		generateState: () => "test-state",
		now: opts.now,
	});
	return { service, store };
}

describe("LinearAuthService", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = makeTestDb();
	});
	afterEach(() => {
		testDb.close();
	});

	it("refuses startConnect when a cloud Linear connection is active (precedence gate)", async () => {
		const { service, store } = buildService({
			db: testDb.db,
			cloudConnected: true,
		});
		await expect(service.startConnect()).rejects.toThrow(
			/cloud Linear connection is active/i,
		);
		expect(store.getStatus()).toEqual({ connected: false });
	});

	it("builds a PKCE authorize URL with the S256 challenge and scopes", async () => {
		const { service } = buildService({ db: testDb.db, cloudConnected: false });
		const { url } = await service.startConnect();
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe(
			"https://linear.app/oauth/authorize",
		);
		expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
		expect(parsed.searchParams.get("response_type")).toBe("code");
		expect(parsed.searchParams.get("scope")).toBe("read,write,issues:create");
		expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge");
		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
		expect(parsed.searchParams.get("state")).toBe("test-state");
		expect(parsed.searchParams.get("redirect_uri")).toContain(
			"http://127.0.0.1:",
		);
		// No secret is ever placed on the authorize request.
		expect(url).not.toContain("client_secret");
	});

	it("throws a clear error when the public client id is missing", async () => {
		const { service } = buildService({
			db: testDb.db,
			cloudConnected: false,
			clientId: undefined,
		});
		await expect(service.startConnect()).rejects.toThrow(
			/LINEAR_DESKTOP_CLIENT_ID/,
		);
	});

	it("exchanges the code with code_verifier and NO client_secret, then stores tokens encrypted", async () => {
		const { fetchFn, calls } = makeFetchFake();
		const { service, store } = buildService({
			db: testDb.db,
			cloudConnected: false,
			fetchFn,
		});

		await service.startConnect();
		const status = await service.completeConnect({ code: "auth-code-xyz" });

		// Status carries the viewer/workspace, and NO token field.
		expect(status.connected).toBe(true);
		expect(status.viewer).toBe("Ada Lovelace");
		expect(status.workspace).toBe("Analytical Engines");
		expect(JSON.stringify(status)).not.toContain("access-token-123");

		// The token exchange body.
		const tokenCall = calls.find((c) => c.url.includes("/oauth/token"));
		expect(tokenCall).toBeDefined();
		const body = tokenCall?.body;
		expect(body?.get("grant_type")).toBe("authorization_code");
		expect(body?.get("code")).toBe("auth-code-xyz");
		expect(body?.get("code_verifier")).toBe("test-verifier");
		expect(body?.get("client_id")).toBe("test-client-id");
		expect(body?.has("client_secret")).toBe(false);

		// The stored token is ciphertext, not the plaintext access token.
		const row = testDb.db.select().from(linearLocalAuth).get() as
			| { accessTokenEnc: string }
			| undefined;
		expect(row?.accessTokenEnc).toBeDefined();
		expect(row?.accessTokenEnc).not.toContain("access-token-123");
		// ...but it decrypts back via the host-internal accessor.
		expect(store.getAccessToken()).toBe("access-token-123");
	});

	it("captures the loopback redirect, exposes the code, then completes", async () => {
		const captured: {
			onCallback:
				| ((result: { code: string; state: string | null }) => void)
				| null;
		} = { onCallback: null };
		const controllableLoopback: () => LinearOAuthLoopback = () => ({
			start: async (o) => {
				captured.onCallback = o.onCallback;
			},
			stop: () => {},
		});
		const { service } = buildService({
			db: testDb.db,
			cloudConnected: false,
			createLoopback: controllableLoopback,
		});

		await service.startConnect();
		expect(service.consumeCallback()).toEqual({ code: null });
		// Wrong state is ignored; matching state is captured.
		captured.onCallback?.({ code: "ignored", state: "other-state" });
		expect(service.consumeCallback()).toEqual({ code: null });
		captured.onCallback?.({ code: "captured-code", state: "test-state" });
		expect(service.consumeCallback()).toEqual({ code: "captured-code" });

		const status = await service.completeConnect({ code: "captured-code" });
		expect(status.connected).toBe(true);
	});

	it("refresh sends grant_type=refresh_token with NO client_secret when near expiry", async () => {
		const { fetchFn, calls } = makeFetchFake({
			tokenResponse: {
				access_token: "rotated-access",
				refresh_token: "rotated-refresh",
				expires_in: 3600,
			},
		});
		const fixedNow = 1_000_000_000_000;
		const { service, store } = buildService({
			db: testDb.db,
			cloudConnected: false,
			fetchFn,
			now: () => fixedNow,
		});
		// Seed a connection whose token expires within the buffer.
		store.save({
			accessToken: "old-access",
			refreshToken: "old-refresh",
			expiresAt: fixedNow + 1000,
			scope: "read",
			viewer: { id: "u1", name: "Ada", email: undefined },
			workspace: { id: "o1", name: "Engines" },
		});

		await service.refresh();

		const refreshCall = calls.find((c) => c.url.includes("/oauth/token"));
		expect(refreshCall?.body?.get("grant_type")).toBe("refresh_token");
		expect(refreshCall?.body?.get("refresh_token")).toBe("old-refresh");
		expect(refreshCall?.body?.get("client_id")).toBe("test-client-id");
		expect(refreshCall?.body?.has("client_secret")).toBe(false);
		expect(store.getAccessToken()).toBe("rotated-access");
	});

	it("refresh is a no-op when the token is not near expiry", async () => {
		const { fetchFn, calls } = makeFetchFake();
		const fixedNow = 1_000_000_000_000;
		const { service, store } = buildService({
			db: testDb.db,
			cloudConnected: false,
			fetchFn,
			now: () => fixedNow,
		});
		store.save({
			accessToken: "fresh-access",
			refreshToken: "fresh-refresh",
			expiresAt: fixedNow + 60 * 60 * 1000,
			scope: "read",
			viewer: null,
			workspace: null,
		});

		await service.refresh();
		expect(calls).toHaveLength(0);
		expect(store.getAccessToken()).toBe("fresh-access");
	});

	it("disconnect purges the local token", async () => {
		const { service, store } = buildService({
			db: testDb.db,
			cloudConnected: false,
		});
		await service.startConnect();
		await service.completeConnect({ code: "code" });
		expect(store.getStatus().connected).toBe(true);

		service.disconnect();
		expect(store.getStatus()).toEqual({ connected: false });
		expect(store.getAccessToken()).toBeNull();
	});
});
