import { INPUT_LIMITS } from "@superset/shared/input-limits";
import type { AppRouter } from "@superset/trpc";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { env } from "renderer/env.renderer";
import superjson from "superjson";
import { getAuthToken } from "./auth-client";

/**
 * HTTP tRPC client for calling the API server.
 * Uses bearer token authentication like the auth client.
 * For mutations only - for fetching data we already have electric
 */
export const apiTrpcClient = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			maxItems: INPUT_LIMITS.batchCalls,
			maxURLLength: INPUT_LIMITS.urlBytes - 4096,
			url: `${env.NEXT_PUBLIC_API_URL}/api/trpc`,
			transformer: superjson,
			headers: () => {
				const token = getAuthToken();
				if (token) {
					return {
						Authorization: `Bearer ${token}`,
					};
				}
				return {};
			},
		}),
	],
});
