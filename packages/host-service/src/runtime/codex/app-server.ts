import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { getCodexProcessEnv, resolveCodexExecutable } from "./executable";

export interface CodexRpc {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	subscribe(listener: (method: string, params: unknown) => void): () => void;
	close(): void;
}

const messageSchema = z.object({
	id: z.union([z.number(), z.string()]).optional(),
	method: z.string().optional(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.object({ message: z.string() }).passthrough().optional(),
});

/** Official Codex app-server JSON-RPC over stdio. No shell, token handling or OAuth reimplementation. */
export class CodexAppServer implements CodexRpc {
	private child: ChildProcessWithoutNullStreams | null = null;
	private ready: Promise<void> | null = null;
	private nextId = 0;
	private pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private listeners = new Set<(method: string, params: unknown) => void>();

	constructor(
		private readonly spawnServer: () => ChildProcessWithoutNullStreams = () =>
			spawn(resolveCodexExecutable(), ["app-server"], {
				stdio: ["pipe", "pipe", "pipe"],
				env: getCodexProcessEnv(),
			}),
		private readonly requestTimeoutMs = 15_000,
	) {}

	private initialize(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = (async () => {
			const child = this.spawnServer();
			this.child = child;
			child.stdin.on("error", () =>
				this.fail(new Error("Codex input stream closed")),
			);
			// stderr may contain authentication URLs; never echo it to logs or the renderer.
			child.stderr.resume();
			child.on("error", () => {
				if (this.child !== child) return;
				this.child = null;
				this.fail(
					new Error(
						"Cannot start local Codex. Check the installed CLI/app or SUPERSET_CODEX_EXECUTABLE.",
					),
				);
			});
			child.on("exit", () => {
				if (this.child !== child) return;
				this.child = null;
				this.fail(new Error("Codex app-server exited. Reconnect and retry."));
			});
			const lines = createInterface({ input: child.stdout });
			lines.on("line", (line) => {
				if (line.length > 2_000_000) {
					this.close();
					return;
				}
				let raw: unknown;
				try {
					raw = JSON.parse(line);
				} catch {
					return;
				}
				const parsed = messageSchema.safeParse(raw);
				if (!parsed.success) return;
				const message = parsed.data;
				if (message.method && message.id !== undefined) {
					// These sessions never auto-approve tool execution, permissions or questions.
					child.stdin.write(
						`${JSON.stringify({ id: message.id, error: { code: -32601, message: "Superset does not approve interactive requests in this session" } })}\n`,
					);
					return;
				}
				if (typeof message.id === "number") {
					const request = this.pending.get(message.id);
					if (!request) return;
					this.pending.delete(message.id);
					clearTimeout(request.timer);
					if (message.error) request.reject(new Error(message.error.message));
					else request.resolve(message.result);
				} else if (message.method) {
					for (const listener of this.listeners)
						listener(message.method, message.params);
				}
			});
			await this.send("initialize", {
				clientInfo: {
					name: "superset_local",
					title: "Superset",
					version: "0.1.0",
				},
			});
			child.stdin.write(
				`${JSON.stringify({ method: "initialized", params: {} })}\n`,
			);
		})();
		return this.ready;
	}
	private send(
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex request timed out: ${method}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child?.stdin.write(
				`${JSON.stringify({ id, method, params })}\n`,
				(error) => {
					if (error) {
						clearTimeout(timer);
						this.pending.delete(id);
						reject(error);
					}
				},
			);
		});
	}
	async request(
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		try {
			await this.initialize();
			return await this.send(method, params);
		} catch (error) {
			this.close();
			throw error;
		}
	}
	subscribe(listener: (method: string, params: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private fail(error: Error): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
		this.ready = null;
	}
	close(): void {
		const child = this.child;
		this.child = null;
		child?.stdin.end();
		child?.kill("SIGTERM");
		if (child) {
			const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
			timer.unref();
		}
		this.fail(new Error("Codex session closed"));
		this.listeners.clear();
	}
}
