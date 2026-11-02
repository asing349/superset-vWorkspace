import { redactText } from "@superset/memory";
import { z } from "zod";
import { CodexAppServer, type CodexRpc } from "./app-server";

const accountSchema = z.object({
	account: z
		.union([
			z.object({
				type: z.literal("chatgpt"),
				email: z.string().nullable().optional(),
				planType: z.string().nullable().optional(),
			}),
			z.object({ type: z.literal("apiKey") }),
			z.object({ type: z.string() }),
		])
		.nullable(),
});
export interface CodexConnectionStatus {
	connected: boolean;
	authMethod: "chatgpt" | "apiKey" | "other" | null;
	email: string | null;
	planType: string | null;
	pending: boolean;
	error: string | null;
}
export function parseCodexAccount(
	value: unknown,
): Omit<CodexConnectionStatus, "pending" | "error"> {
	const { account } = accountSchema.parse(value);
	const chatgpt =
		account?.type === "chatgpt"
			? z
					.object({
						email: z.string().nullable().optional(),
						planType: z.string().nullable().optional(),
					})
					.parse(account)
			: null;
	return {
		connected: account !== null,
		authMethod:
			account?.type === "chatgpt"
				? "chatgpt"
				: account?.type === "apiKey"
					? "apiKey"
					: account
						? "other"
						: null,
		email: chatgpt?.email ?? null,
		planType: chatgpt?.planType ?? null,
	};
}
export function validateCodexLoginUrl(raw: string): string {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" ||
		!["auth.openai.com", "chatgpt.com"].includes(url.hostname) ||
		url.username ||
		url.password
	)
		throw new Error("Codex returned an unsupported sign-in URL");
	return url.toString();
}

/** Shares the installed CLI's account; Mastracode's separate model credentials are untouched. */
export class CodexConnection {
	private rpc: CodexRpc | null = null;
	private loginId: string | null = null;
	private starting = false;
	private expiry: ReturnType<typeof setTimeout> | null = null;
	private error: string | null = null;
	constructor(
		private readonly createRpc: () => CodexRpc = () => new CodexAppServer(),
	) {}
	private client(): CodexRpc {
		if (!this.rpc) {
			this.rpc = this.createRpc();
			this.rpc.subscribe((method, raw) => {
				if (method !== "account/login/completed") return;
				const value = z
					.object({
						loginId: z.string().nullable(),
						success: z.boolean(),
						error: z.string().nullable().optional(),
					})
					.safeParse(raw);
				if (!value.success || value.data.loginId !== this.loginId) return;
				this.clearPending();
				this.error = value.data.success
					? null
					: redactText(value.data.error ?? "Sign-in did not complete").text;
			});
		}
		return this.rpc;
	}
	private clearPending(): void {
		this.loginId = null;
		if (this.expiry) clearTimeout(this.expiry);
		this.expiry = null;
	}
	async status(): Promise<CodexConnectionStatus> {
		try {
			return {
				...parseCodexAccount(
					await this.client().request("account/read", { refreshToken: false }),
				),
				pending: this.loginId !== null,
				error: this.error,
			};
		} catch (error) {
			this.dispose();
			return {
				connected: false,
				authMethod: null,
				email: null,
				planType: null,
				pending: false,
				error:
					error instanceof Error
						? redactText(error.message).text
						: "Cannot read Codex account",
			};
		}
	}
	async start(): Promise<{ authUrl: string }> {
		if (this.loginId || this.starting)
			throw new Error(
				"A Codex sign-in is already pending. Cancel it before starting again.",
			);
		this.error = null;
		this.starting = true;
		try {
			const result = z
				.object({
					loginId: z.string(),
					authUrl: z.string(),
					type: z.literal("chatgpt"),
				})
				.parse(
					await this.client().request("account/login/start", {
						type: "chatgpt",
					}),
				);
			this.loginId = result.loginId;
			try {
				const authUrl = validateCodexLoginUrl(result.authUrl);
				this.expiry = setTimeout(() => {
					void this.cancel().catch(() => this.dispose());
					this.error = "Sign-in expired. Connect again.";
				}, 5 * 60_000);
				this.expiry.unref();
				return { authUrl };
			} catch (error) {
				await this.cancel();
				throw error;
			}
		} catch (error) {
			this.dispose();
			throw new Error(
				redactText(
					error instanceof Error ? error.message : "Codex sign-in failed",
				).text,
			);
		} finally {
			this.starting = false;
		}
	}
	async cancel(): Promise<void> {
		const loginId = this.loginId;
		try {
			if (loginId)
				await this.client().request("account/login/cancel", { loginId });
		} finally {
			this.clearPending();
		}
	}
	async disconnect(): Promise<void> {
		await this.cancel();
		await this.client().request("account/logout", {});
		this.error = null;
	}
	dispose(): void {
		this.clearPending();
		this.rpc?.close();
		this.rpc = null;
	}
}
