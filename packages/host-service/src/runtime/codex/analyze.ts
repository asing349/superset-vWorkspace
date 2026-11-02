import { z } from "zod";
import { CodexAppServer, type CodexRpc } from "./app-server";

/** A separate, fresh Codex process + thread for every planner/reviewer turn. */
export async function analyzeWithCodex(options: {
	cwd: string;
	readableRoots?: string[];
	prompt: string;
	outputSchema: Record<string, unknown>;
	createRpc?: () => CodexRpc;
	timeoutMs?: number;
}): Promise<{ text: string; sessionId: string }> {
	const rpc = options.createRpc?.() ?? new CodexAppServer();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe = () => {};
	try {
		const config = z
			.object({
				config: z
					.object({
						mcp_servers: z.record(z.string(), z.unknown()).optional(),
						apps: z.record(z.string(), z.unknown()).optional(),
					})
					.passthrough(),
			})
			.parse(
				await rpc.request("config/read", {
					includeLayers: false,
					cwd: options.cwd,
				}),
			);
		const overrides: Record<string, unknown> = {
			"apps._default.enabled": false,
			"features.hooks": false,
		};
		for (const name of Object.keys(config.config.mcp_servers ?? {}))
			overrides[`mcp_servers.${JSON.stringify(name)}.enabled`] = false;
		for (const name of Object.keys(config.config.apps ?? {}))
			overrides[`apps.${JSON.stringify(name)}.enabled`] = false;
		const { thread } = z.object({ thread: z.object({ id: z.string() }) }).parse(
			await rpc.request("thread/start", {
				cwd: options.cwd,
				approvalPolicy: "never",
				config: overrides,
			}),
		);
		let text = "";
		const completed = new Promise<string>((resolve, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							"Codex plan analysis timed out; execution remains blocked",
						),
					),
				options.timeoutMs ?? 120_000,
			);
			unsubscribe = rpc.subscribe((method, raw) => {
				const envelope = z
					.object({
						threadId: z.string().optional(),
						item: z
							.object({ type: z.string(), text: z.string().optional() })
							.passthrough()
							.optional(),
						turn: z
							.object({
								status: z.string(),
								error: z.object({ message: z.string() }).nullable().optional(),
							})
							.passthrough()
							.optional(),
					})
					.safeParse(raw);
				if (!envelope.success || envelope.data.threadId !== thread.id) return;
				if (
					method === "item/completed" &&
					envelope.data.item?.type === "agentMessage"
				)
					text = envelope.data.item.text ?? text;
				if (method === "turn/completed") {
					if (envelope.data.turn?.status === "completed" && text.trim())
						resolve(text);
					else
						reject(
							new Error(
								envelope.data.turn?.error?.message ??
									"Codex returned no completed plan decision; execution remains blocked",
							),
						);
				}
			});
		});
		// Attach the handler before starting the turn so fast completions aren't lost.
		const turn = rpc.request("turn/start", {
			threadId: thread.id,
			input: [{ type: "text", text: options.prompt }],
			approvalPolicy: "never",
			sandboxPolicy: {
				type: "readOnly",
				access: {
					type: "restricted",
					includePlatformDefaults: true,
					readableRoots: options.readableRoots ?? [options.cwd],
				},
			},
			outputSchema: options.outputSchema,
		});
		// Both promises are observed even when the start request fails.
		const [, answer] = await Promise.all([turn, completed]);
		return { text: answer, sessionId: thread.id };
	} finally {
		if (timer) clearTimeout(timer);
		unsubscribe();
		rpc.close();
	}
}
