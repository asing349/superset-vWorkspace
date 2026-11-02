import { INPUT_LIMITS } from "@superset/shared/input-limits";
import { httpBatchLink, splitLink, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { ChatRuntimeServiceRouter } from "../../server/trpc";
import {
	type ChatRuntimeServiceClient,
	chatRuntimeServiceTrpc,
} from "./provider";

export interface CreateChatRuntimeServiceClientOptions {
	links: TRPCLink<ChatRuntimeServiceRouter>[];
}

export interface CreateChatRuntimeServiceHttpClientOptions {
	url: string;
	headers?:
		| Record<string, string>
		| (() => Record<string, string> | Promise<Record<string, string>>);
	fetch?: typeof fetch;
}

export function createChatRuntimeServiceClient({
	links,
}: CreateChatRuntimeServiceClientOptions): ChatRuntimeServiceClient {
	return chatRuntimeServiceTrpc.createClient({ links });
}

export function createChatRuntimeServiceHttpClient({
	url,
	headers,
	fetch,
}: CreateChatRuntimeServiceHttpClientOptions): ChatRuntimeServiceClient {
	return createChatRuntimeServiceClient({
		links: [
			splitLink({
				condition: ({ path }) =>
					/(?:^|\.)(?:sendMessage|restartFromMessage)$/.test(path),
				true: httpBatchLink({
					url,
					transformer: superjson,
					headers,
					...(fetch ? { fetch } : {}),
					maxItems: 1,
					maxURLLength: INPUT_LIMITS.urlBytes - 4096,
				}),
				false: httpBatchLink({
					url,
					transformer: superjson,
					headers,
					...(fetch ? { fetch } : {}),
					maxItems: INPUT_LIMITS.batchCalls,
					maxURLLength: INPUT_LIMITS.urlBytes - 4096,
				}),
			}),
		],
	});
}
