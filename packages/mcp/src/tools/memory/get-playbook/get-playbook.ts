import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryDataProvider } from "../../../memory/types";

/**
 * `memory.getPlaybook` — fetch one Playbook (a distilled record of how a past
 * task was done) by id, including its full touched paths + commands.
 */
export function registerMemoryGetPlaybook(
	server: McpServer,
	provider: MemoryDataProvider,
): void {
	server.registerTool(
		"memory_get_playbook",
		{
			description:
				"Get a single Superset Memory playbook (a distilled record of how a past task was done) by id.",
			inputSchema: {
				id: z.string().describe("Playbook id."),
			},
		},
		async (args) => {
			const playbook = await provider.getPlaybook({ id: args.id as string });
			if (!playbook) {
				return {
					content: [{ type: "text", text: "Error: Playbook not found" }],
					isError: true,
				};
			}
			return {
				structuredContent: { playbook } as unknown as Record<string, unknown>,
				content: [
					{ type: "text", text: JSON.stringify({ playbook }, null, 2) },
				],
			};
		},
	);
}
