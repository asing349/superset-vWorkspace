import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryDataProvider } from "../../../memory/types";

/**
 * `memory.getPractice` — fetch the latest Coding Practice doc for a scope
 * (project or global). Content is null until consolidation (B5) has written one.
 */
export function registerMemoryGetPractice(
	server: McpServer,
	provider: MemoryDataProvider,
): void {
	server.registerTool(
		"memory_get_practice",
		{
			description:
				"Get the latest Superset Memory coding-practice doc for a scope (project or global). Follow these durable rules for this repo / this user.",
			inputSchema: {
				scope: z.enum(["project", "global"]).describe("Practice scope."),
				projectId: z
					.string()
					.nullable()
					.optional()
					.describe("Project id for scope=project."),
			},
		},
		async (args) => {
			const result = await provider.getPractice({
				scope: args.scope as "project" | "global",
				projectId: (args.projectId as string | null | undefined) ?? null,
			});
			return {
				structuredContent: result as unknown as Record<string, unknown>,
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);
}
