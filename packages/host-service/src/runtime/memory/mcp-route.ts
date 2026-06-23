import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import type { HostDb } from "../../db/index.ts";
import { createHostMemoryMcpServer } from "./mcp-provider.ts";
import type { MemoryRetrieveService } from "./retrieve-service.ts";

/**
 * Loopback HTTP endpoint that serves the LOCAL "superset-memory" MCP server
 * (Superset Memory B4 → wave-4 A1). An external CLI agent (Claude Code, Codex,
 * Cursor, OpenCode) running on the SAME machine connects here over MCP-over-HTTP
 * (Streamable HTTP) and calls `memory_search` / `memory_get_playbook` /
 * `memory_get_practice`.
 *
 * Why this transport: it mirrors the cloud MCP route
 * (`apps/api/.../agent/[transport]/route.ts`) which serves the org-scoped MCP
 * server over `WebStandardStreamableHTTPServerTransport`. That transport is
 * web-standard (`Request` → `Response`), so it drops straight onto the Hono app
 * the host already runs — no new server, port, or socket plumbing. The host
 * binds `127.0.0.1` only (see the desktop main / CLI `serve`), so mounting on it
 * is loopback-only and egress-free by construction.
 *
 * Why no auth: the memory server is LOCAL + provider-scoped and reads only the
 * host's SQLite memory tables (no cloud db, no network). It is reachable only
 * from this machine's loopback interface, so — unlike the cloud server — it
 * needs no org/user auth context. (The route is intentionally NOT placed behind
 * the `wsAuth` PSK gate so a local agent can connect without the host secret.)
 *
 * Stateless mode: `sessionIdGenerator: undefined` + `enableJsonResponse: true`
 * means each request connects a fresh server/transport pair and returns a plain
 * JSON-RPC response — the simplest shape for a local pull, identical in spirit
 * to the cloud route's per-request `server.connect(transport)`.
 */

/** Stable loopback path the memory MCP server is mounted at. */
export const MEMORY_MCP_ROUTE_PATH = "/mcp/memory";

export function registerMemoryMcpRoute(options: {
	app: Hono;
	db: HostDb;
	retrieve: MemoryRetrieveService;
}): void {
	const { app, db, retrieve } = options;

	const handle = async (req: Request): Promise<Response> => {
		// Per-request server + transport (stateless): mirrors the cloud route.
		// The server reads the injected host data provider only; no shared state
		// to leak between requests.
		const server = createHostMemoryMcpServer({ db, retrieve });
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		const response = await transport.handleRequest(req);
		// Best-effort close so the per-request pair is released; a throw here must
		// not turn a served response into a 500.
		void server.close().catch(() => {});
		return response;
	};

	app.all(MEMORY_MCP_ROUTE_PATH, (c) => handle(c.req.raw));
}
