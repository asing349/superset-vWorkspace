import { expect, test } from "bun:test";
import { analyzeWithCodex } from "./analyze";
import type { CodexRpc } from "./app-server";

class FakeRpc implements CodexRpc {
	calls: { method: string; params: Record<string, unknown> }[] = [];
	closed = false;
	finish = true;
	listeners = new Set<(method: string, params: unknown) => void>();
	async request(method: string, params: Record<string, unknown>) {
		this.calls.push({ method, params });
		if (method === "config/read")
			return { config: { mcp_servers: { linear: {} }, apps: { github: {} } } };
		if (method === "thread/start") return { thread: { id: "fresh-thread" } };
		if (method === "turn/start" && this.finish)
			for (const fn of this.listeners) {
				fn("item/completed", {
					threadId: "wrong",
					item: { type: "agentMessage", text: "wrong-thread" },
				});
				fn("item/completed", {
					threadId: "fresh-thread",
					item: {
						type: "agentMessage",
						text: '{"decision":"approved","feedback":["Scoped"]}',
					},
				});
				fn("turn/completed", {
					threadId: "fresh-thread",
					turn: { status: "completed" },
				});
			}
		return {};
	}
	subscribe(fn: (method: string, params: unknown) => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	close() {
		this.closed = true;
	}
}
test("fresh review session uses read-only sandbox, disables external tools and returns final response", async () => {
	const rpc = new FakeRpc();
	const result = await analyzeWithCodex({
		cwd: "/repo",
		prompt: "review",
		outputSchema: { type: "object" },
		createRpc: () => rpc,
	});
	expect(result.sessionId).toBe("fresh-thread");
	expect(result.text).not.toContain("wrong-thread");
	const thread = rpc.calls.find((call) => call.method === "thread/start");
	expect(thread?.params).toMatchObject({
		approvalPolicy: "never",
		config: {
			'mcp_servers."linear".enabled': false,
			'apps."github".enabled': false,
		},
	});
	expect(
		rpc.calls.find((call) => call.method === "turn/start")?.params
			.sandboxPolicy,
	).toMatchObject({
		type: "readOnly",
		access: { type: "restricted", readableRoots: ["/repo"] },
	});
	expect(rpc.closed).toBe(true);
});
test("timeout closes the process and never yields approval", async () => {
	const rpc = new FakeRpc();
	rpc.finish = false;
	await expect(
		analyzeWithCodex({
			cwd: "/repo",
			prompt: "review",
			outputSchema: {},
			createRpc: () => rpc,
			timeoutMs: 5,
		}),
	).rejects.toThrow("timed out");
	expect(rpc.closed).toBe(true);
});
