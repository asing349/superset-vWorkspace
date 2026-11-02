import { INPUT_LIMITS } from "@superset/shared/input-limits";
import type { AppRouter } from "@superset/trpc";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { authClient } from "../auth/client";
import { env } from "../env";

export const apiClient = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			maxItems: INPUT_LIMITS.batchCalls,
			maxURLLength: INPUT_LIMITS.urlBytes - 4096,
			url: `${env.EXPO_PUBLIC_API_URL}/api/trpc`,
			async headers() {
				const cookies = await authClient.getCookie();
				return cookies ? { Cookie: cookies } : {};
			},
			transformer: superjson,
		}),
	],
});
