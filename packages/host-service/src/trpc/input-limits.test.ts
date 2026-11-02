import { expect, test } from "bun:test";
import { INPUT_LIMITS } from "@superset/shared/input-limits";
import { z } from "zod";
import { sendMessagePayloadSchema } from "../../../chat/src/server/trpc/zod";
import { createTaskSchema } from "../../../trpc/src/router/task/schema";
import { ticketPlanScopeSchema } from "../runtime/ticket-plans/types";
import type { HostServiceContext } from "../types";
import { publicProcedure, router } from "./index";

test("direct callers reject before Zod children or resolver run", async () => {
	let children = 0;
	let resolved = false;
	const r = router({
		check: publicProcedure
			.input(
				z.array(
					z.preprocess((v) => {
						children++;
						return v;
					}, z.string()),
				),
			)
			.mutation(() => {
				resolved = true;
			}),
	});
	await expect(
		r.createCaller({} as HostServiceContext).check(Array(4097).fill(0)),
	).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
	expect(children).toBe(0);
	expect(resolved).toBe(false);
});
test("ordinary direct inputs still return transformed values and complete diagnostics", async () => {
	const r = router({
		check: publicProcedure
			.input(z.array(z.string().transform((s) => s.toUpperCase())))
			.mutation(({ input }) => input),
	});
	expect(await r.createCaller({} as HostServiceContext).check(["ok"])).toEqual([
		"OK",
	]);
	try {
		await r
			.createCaller({} as HostServiceContext)
			.check([0, 0] as unknown as string[]);
		throw new Error("accepted invalid input");
	} catch (error) {
		expect(
			(error as { cause: { issues: unknown[] } }).cause.issues.length,
		).toBe(2);
	}
});
test("ticket repository boundary retains multi-repo and rejects oversize before children", () => {
	const scope = {
		taskId: "t",
		ticketKey: "T-1",
		approvedContextProjectId: "p",
		repos: Array.from({ length: INPUT_LIMITS.repositories }, (_, i) => ({
			projectId: `p${i}`,
		})),
	};
	expect(ticketPlanScopeSchema.parse(scope).repos.length).toBe(32);
	const result = ticketPlanScopeSchema.safeParse({
		...scope,
		repos: Array(33).fill(null),
	});
	expect(result.success).toBe(false);
	if (result.success) throw new Error("accepted oversize");
	expect(result.error.issues).toHaveLength(1);
	expect(result.error.issues[0]?.code).toBe("too_big");
});
test("chat file and task label ceilings keep ordinary/boundary input", () => {
	const files = Array.from({ length: INPUT_LIMITS.files }, () => ({
		data: "eA==",
		mediaType: "text/plain",
	}));
	expect(
		sendMessagePayloadSchema.parse({ content: "hi", files }).files?.length,
	).toBe(16);
	const result = sendMessagePayloadSchema.safeParse({
		content: "hi",
		files: Array(17).fill(null),
	});
	expect(result.success).toBe(false);
	if (result.success) throw new Error("accepted oversize");
	expect(result.error.issues).toHaveLength(1);
	expect(
		createTaskSchema.parse({ title: "t", labels: Array(128).fill("label") })
			.labels?.length,
	).toBe(128);
	expect(
		createTaskSchema.safeParse({ title: "t", labels: Array(129).fill(0) })
			.success,
	).toBe(false);
});

test("HTTP size errors remain readable through actual batch and stream clients", async () => {
	const { createTRPCClient, httpBatchLink, httpBatchStreamLink } = await import(
		"@trpc/client"
	);
	const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
	const { limitJsonRequest } = await import("@superset/shared/request-limits");
	const { default: superjson } = await import("superjson");
	const r = router({
		check: publicProcedure
			.input(z.string())
			.mutation(({ input }) => input.length),
	});
	for (const link of [httpBatchLink, httpBatchStreamLink]) {
		const client = createTRPCClient<typeof r>({
			links: [
				link({
					url: "http://localhost/trpc",
					transformer: superjson,
					maxItems: INPUT_LIMITS.batchCalls,
					fetch: (async (url: string, init?: RequestInit) => {
						const bounded = await limitJsonRequest(new Request(url, init));
						if (bounded instanceof Response) return bounded;
						return fetchRequestHandler({
							endpoint: "/trpc",
							req: bounded,
							router: r,
							createContext: () => ({}) as HostServiceContext,
							maxBatchSize: INPUT_LIMITS.batchCalls,
						});
					}) as unknown as NonNullable<
						Parameters<typeof httpBatchLink>[0]["fetch"]
					>,
				}),
			],
		});
		expect(await client.check.mutate("ok")).toBe(2);
		await expect(
			client.check.mutate("x".repeat(INPUT_LIMITS.requestBytes)),
		).rejects.toMatchObject({
			message: "Request body exceeds the supported size limit.",
			data: { code: "PAYLOAD_TOO_LARGE" },
		});
	}
});

test("client splits startup bursts at the server batch ceiling", async () => {
	const { createTRPCClient, httpBatchLink } = await import("@trpc/client");
	const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
	const { limitJsonRequest } = await import("@superset/shared/request-limits");
	const { default: superjson } = await import("superjson");
	const sizes: number[] = [];
	const r = router({
		check: publicProcedure.input(z.number()).query(({ input }) => input),
	});
	const client = createTRPCClient<typeof r>({
		links: [
			httpBatchLink({
				url: "http://localhost/trpc",
				transformer: superjson,
				maxItems: INPUT_LIMITS.batchCalls,
				fetch: (async (url: string, init?: RequestInit) => {
					const req = new Request(url, init);
					sizes.push(new URL(req.url).pathname.split(",").length);
					const bounded = await limitJsonRequest(req);
					if (bounded instanceof Response) return bounded;
					return fetchRequestHandler({
						endpoint: "/trpc",
						req: bounded,
						router: r,
						createContext: () => ({}) as HostServiceContext,
						maxBatchSize: INPUT_LIMITS.batchCalls,
					});
				}) as unknown as NonNullable<
					Parameters<typeof httpBatchLink>[0]["fetch"]
				>,
			}),
		],
	});
	expect(
		await Promise.all(
			Array.from({ length: 40 }, (_, i) => client.check.query(i)),
		),
	).toEqual(Array.from({ length: 40 }, (_, i) => i));
	expect(sizes).toEqual([32, 8]);
});
