import { describe, expect, test } from "bun:test";
import type { CodexRpc } from "./app-server";
import {
	CodexConnection,
	parseCodexAccount,
	validateCodexLoginUrl,
} from "./connection";

class FakeRpc implements CodexRpc {
	calls: { method: string; params: Record<string, unknown> }[] = [];
	listeners = new Set<(method: string, params: unknown) => void>();
	account: unknown = null;
	closed = false;
	async request(method: string, params: Record<string, unknown>) {
		this.calls.push({ method, params });
		if (method === "account/read") return { account: this.account };
		if (method === "account/login/start")
			return {
				type: "chatgpt",
				loginId: "login",
				authUrl: "https://auth.openai.com/authorize?state=example",
			};
		return {};
	}
	subscribe(fn: (method: string, params: unknown) => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	close() {
		this.closed = true;
	}
	emit(params: unknown) {
		for (const fn of this.listeners) fn("account/login/completed", params);
	}
}
describe("Codex CLI account connection", () => {
	test("reports subscription login separately from API credentials", () => {
		expect(
			parseCodexAccount({
				account: {
					type: "chatgpt",
					email: "person@example.test",
					planType: "plus",
					token: "never-return",
				},
			}),
		).toEqual({
			connected: true,
			authMethod: "chatgpt",
			email: "person@example.test",
			planType: "plus",
		});
		expect(parseCodexAccount({ account: { type: "apiKey" } }).authMethod).toBe(
			"apiKey",
		);
		expect(parseCodexAccount({ account: null }).connected).toBe(false);
	});
	test("construction does not start a process or sign in; status is read-only", async () => {
		let created = 0;
		const rpc = new FakeRpc();
		const service = new CodexConnection(() => {
			created++;
			return rpc;
		});
		expect(created).toBe(0);
		await service.status();
		expect(rpc.calls).toEqual([
			{ method: "account/read", params: { refreshToken: false } },
		]);
		service.dispose();
	});
	test("starts official ChatGPT login, stays pending until matching completion and handles cancellation", async () => {
		const rpc = new FakeRpc();
		const service = new CodexConnection(() => rpc);
		await service.start();
		expect(rpc.calls[0]).toEqual({
			method: "account/login/start",
			params: { type: "chatgpt" },
		});
		rpc.emit({ loginId: "other", success: true, error: null });
		expect((await service.status()).pending).toBe(true);
		await expect(service.start()).rejects.toThrow("already pending");
		await service.cancel();
		expect(
			rpc.calls.some((call) => call.method === "account/login/cancel"),
		).toBe(true);
		expect((await service.status()).pending).toBe(false);
		service.dispose();
	});
	test("success is established by account/read, not opening the browser", async () => {
		const rpc = new FakeRpc();
		const service = new CodexConnection(() => rpc);
		await service.start();
		expect((await service.status()).connected).toBe(false);
		rpc.account = { type: "chatgpt", email: null, planType: "pro" };
		rpc.emit({ loginId: "login", success: true, error: null });
		expect(await service.status()).toMatchObject({
			connected: true,
			authMethod: "chatgpt",
			pending: false,
		});
		await service.disconnect();
		expect(rpc.calls.at(-1)?.method).toBe("account/logout");
		service.dispose();
		expect(rpc.closed).toBe(true);
	});
	test("rejects credential-bearing or foreign browser URLs", () => {
		for (const url of [
			"http://auth.openai.com/login",
			"https://auth.openai.com.evil.test/login",
			"https://person:password@chatgpt.com/login",
			"file:///tmp/login",
		])
			expect(() => validateCodexLoginUrl(url)).toThrow();
	});
});
