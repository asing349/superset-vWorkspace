import { INPUT_LIMITS } from "@superset/shared/input-limits";
import { limitJsonRequest } from "@superset/shared/request-limits";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { ChatRuntimeService, type ChatRuntimeServiceRouter } from "../trpc";

export interface CreateChatRuntimeHonoAppOptions {
	endpoint?: string;
}

export function createChatRuntimeHonoApp({
	endpoint = "/trpc/chat",
}: CreateChatRuntimeHonoAppOptions = {}): {
	app: Hono;
	router: ChatRuntimeServiceRouter;
} {
	const app = new Hono();
	const service = new ChatRuntimeService({
		headers: () => ({}),
		apiUrl: "",
	});
	const router = service.createRouter();

	app.all(`${endpoint}/*`, async (c) => {
		const bounded = await limitJsonRequest(c.req.raw);
		if (bounded instanceof Response) return bounded;
		return fetchRequestHandler({
			maxBatchSize: INPUT_LIMITS.batchCalls,
			endpoint,
			req: bounded,
			router,
		});
	});

	return { app, router };
}
