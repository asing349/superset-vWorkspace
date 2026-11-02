import {
	assertInputWithinLimits,
	InputLimitError,
} from "@superset/shared/input-limits";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import type { ChatService } from "../chat-service";
import { getSlashCommands, resolveSlashCommand } from "../slash-commands";
import { searchFiles } from "./file-search";
import { getMcpOverview } from "./mcp-overview";

const t = initTRPC.create({ transformer: superjson });
const procedure = t.procedure.use(async ({ getRawInput, next }) => {
	const raw = await getRawInput();
	try {
		assertInputWithinLimits(raw);
	} catch (error) {
		if (error instanceof InputLimitError)
			throw new TRPCError({
				code: "PAYLOAD_TOO_LARGE",
				message: error.message,
			});
		throw error;
	}
	return next();
});

export const searchFilesInput = z.object({
	rootPath: z.string(),
	query: z.string(),
	includeHidden: z.boolean().default(false),
	limit: z.number().default(20),
});

export const getSlashCommandsInput = z.object({
	cwd: z.string(),
});

export const getMcpOverviewInput = z.object({
	cwd: z.string(),
});

export const resolveSlashCommandInput = z.object({
	cwd: z.string(),
	text: z.string(),
});
export const previewSlashCommandInput = resolveSlashCommandInput;

export const anthropicOAuthCodeInput = z.object({
	code: z.string().min(1),
});

export const openAIOAuthCodeInput = z.object({
	code: z.string().optional(),
});

export const anthropicApiKeyInput = z.object({
	apiKey: z.string().min(1),
});

export const anthropicEnvConfigInput = z.object({
	envText: z.string(),
});

export const openAIApiKeyInput = z.object({
	apiKey: z.string().min(1),
});

function resolveWorkspaceSlashCommand(input: { cwd: string; text: string }) {
	return resolveSlashCommand(input.cwd, input.text);
}

export function createChatServiceRouter(service: ChatService) {
	return t.router({
		workspace: t.router({
			searchFiles: procedure
				.input(searchFilesInput)
				.query(async ({ input }) => {
					return searchFiles({
						rootPath: input.rootPath,
						query: input.query,
						includeHidden: input.includeHidden,
						limit: input.limit,
					});
				}),

			getSlashCommands: procedure
				.input(getSlashCommandsInput)
				.query(async ({ input }) => {
					return getSlashCommands(input.cwd);
				}),

			getMcpOverview: procedure
				.input(getMcpOverviewInput)
				.query(async ({ input }) => {
					return getMcpOverview(input.cwd);
				}),

			resolveSlashCommand: procedure
				.input(resolveSlashCommandInput)
				.mutation(async ({ input }) => {
					return resolveWorkspaceSlashCommand(input);
				}),

			previewSlashCommand: procedure
				.input(resolveSlashCommandInput)
				.query(async ({ input }) => {
					return resolveWorkspaceSlashCommand(input);
				}),
		}),

		auth: t.router({
			getAnthropicStatus: procedure.query(() => {
				return service.getAnthropicAuthStatus();
			}),
			getOpenAIStatus: procedure.query(() => {
				return service.getOpenAIAuthStatus();
			}),
			startOpenAIOAuth: procedure.mutation(() => {
				return service.startOpenAIOAuth();
			}),
			completeOpenAIOAuth: procedure
				.input(openAIOAuthCodeInput)
				.mutation(async ({ input }) => {
					return service.completeOpenAIOAuth({ code: input.code });
				}),
			cancelOpenAIOAuth: procedure.mutation(() => {
				return service.cancelOpenAIOAuth();
			}),
			consumeOpenAIOAuthCallback: procedure.query(() => {
				return service.consumeOpenAIOAuthCallback();
			}),
			disconnectOpenAIOAuth: procedure.mutation(() => {
				return service.disconnectOpenAIOAuth();
			}),
			startAnthropicOAuth: procedure.mutation(() => {
				return service.startAnthropicOAuth();
			}),
			completeAnthropicOAuth: procedure
				.input(anthropicOAuthCodeInput)
				.mutation(async ({ input }) => {
					return service.completeAnthropicOAuth({ code: input.code });
				}),
			cancelAnthropicOAuth: procedure.mutation(() => {
				return service.cancelAnthropicOAuth();
			}),
			disconnectAnthropicOAuth: procedure.mutation(() => {
				return service.disconnectAnthropicOAuth();
			}),
			setAnthropicApiKey: procedure
				.input(anthropicApiKeyInput)
				.mutation(({ input }) => {
					return service.setAnthropicApiKey({ apiKey: input.apiKey });
				}),
			getAnthropicEnvConfig: procedure.query(() => {
				return service.getAnthropicEnvConfig();
			}),
			setAnthropicEnvConfig: procedure
				.input(anthropicEnvConfigInput)
				.mutation(({ input }) => {
					return service.setAnthropicEnvConfig({
						envText: input.envText,
					});
				}),
			clearAnthropicEnvConfig: procedure.mutation(() => {
				return service.clearAnthropicEnvConfig();
			}),
			clearAnthropicApiKey: procedure.mutation(() => {
				return service.clearAnthropicApiKey();
			}),
			setOpenAIApiKey: procedure
				.input(openAIApiKeyInput)
				.mutation(({ input }) => {
					return service.setOpenAIApiKey({ apiKey: input.apiKey });
				}),
			clearOpenAIApiKey: procedure.mutation(() => {
				return service.clearOpenAIApiKey();
			}),
		}),
	});
}

export type ChatServiceRouter = ReturnType<typeof createChatServiceRouter>;
