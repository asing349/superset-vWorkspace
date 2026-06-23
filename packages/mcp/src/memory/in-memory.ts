import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemoryMcpServer } from "./server";
import type { MemoryDataProvider } from "./types";

/**
 * Connect a client to a LOCAL memory MCP server over an in-memory transport
 * (no sockets, no network). Used by tests and by any in-process consumer; the
 * host can also serve the same server over a stdio/local transport for external
 * CLI agents. The memory server needs no auth context (it is local + provider-
 * scoped), so unlike the cloud `createInMemoryMcpClient` there is no org/user
 * injection here.
 */
export async function createInMemoryMemoryMcpClient(
	provider: MemoryDataProvider,
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
	const server = createMemoryMcpServer(provider);
	const [serverTransport, clientTransport] =
		InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);

	const client = new Client({
		name: "superset-memory-internal",
		version: "1.0.0",
	});
	await client.connect(clientTransport);

	return {
		client,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}
