import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryDataProvider } from "../../../memory/types";

/**
 * `memory.search` — pull the high-signal retrieval bundle for an intent
 * (relevant Coding Practice + top-k area-filtered Playbooks + Project-Index
 * slices, token-capped). Local-only; reads via the injected provider.
 */
export function registerMemorySearch(
	server: McpServer,
	provider: MemoryDataProvider,
): void {
	server.registerTool(
		"memory_search",
		{
			description:
				"Search Superset Memory for the current task: returns relevant coding practice, top-k area-filtered playbooks, and project-index slices (token-capped). Call this BEFORE exploring the codebase to reuse prior solutions and conventions.",
			inputSchema: {
				intent: z
					.string()
					.describe("What you are about to do (free text or a path)."),
				projectId: z
					.string()
					.nullable()
					.optional()
					.describe("Project id to scope memory to."),
				areaTags: z
					.array(z.string())
					.optional()
					.describe("Explicit area hints (e.g. backend, schema)."),
				topKPlaybooks: z.number().int().min(1).max(50).optional(),
				topKIndexSlices: z.number().int().min(1).max(50).optional(),
				maxTokens: z.number().int().min(100).max(20000).optional(),
				includeProvisional: z.boolean().optional(),
			},
		},
		async (args) => {
			const result = await provider.search({
				intent: args.intent as string,
				projectId: (args.projectId as string | null | undefined) ?? null,
				areaTags: args.areaTags as string[] | undefined,
				topKPlaybooks: args.topKPlaybooks as number | undefined,
				topKIndexSlices: args.topKIndexSlices as number | undefined,
				maxTokens: args.maxTokens as number | undefined,
				includeProvisional: args.includeProvisional as boolean | undefined,
			});
			return {
				structuredContent: result as unknown as Record<string, unknown>,
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);
}
