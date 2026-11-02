import { INPUT_LIMITS } from "@superset/shared/input-limits";
import type { AppRouter } from "@superset/trpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

import { env } from "../env";

export const trpcClient = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			maxItems: INPUT_LIMITS.batchCalls,
			maxURLLength: INPUT_LIMITS.urlBytes - 4096,
			url: `${env.NEXT_PUBLIC_API_URL}/api/trpc`,
			transformer: SuperJSON,
			fetch(url, options) {
				return fetch(url, { ...options, credentials: "include" });
			},
		}),
	],
});
