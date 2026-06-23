import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryGetPlaybook } from "../tools/memory/get-playbook";
import { registerMemoryGetPractice } from "../tools/memory/get-practice";
import { registerMemorySearch } from "../tools/memory/search";
import type { MemoryDataProvider } from "./types";

/**
 * Build a LOCAL, egress-free "memory" MCP server. Exposes `memory_search`,
 * `memory_get_playbook`, and `memory_get_practice`, all backed by the injected
 * `MemoryDataProvider` (host-service local SQLite). Separate from the cloud
 * `createMcpServer` — this one makes NO network calls and needs no org auth, so
 * any local CLI agent can connect over a local transport and pull memory.
 */
export function createMemoryMcpServer(provider: MemoryDataProvider): McpServer {
	const server = new McpServer(
		{ name: "superset-memory", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	);
	registerMemorySearch(server, provider);
	registerMemoryGetPlaybook(server, provider);
	registerMemoryGetPractice(server, provider);
	return server;
}
