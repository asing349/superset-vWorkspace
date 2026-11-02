import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { CodexAppServer } from "./app-server";

function fixture() {
	const output = new PassThrough();
	const requests: Record<string, unknown>[] = [];
	const child = new EventEmitter();
	let killed = false;
	const input = new Writable({
		write(chunk, _encoding, callback) {
			const value = JSON.parse(String(chunk)) as Record<string, unknown>;
			requests.push(value);
			if (value.method === "initialize")
				queueMicrotask(() =>
					output.write(`${JSON.stringify({ id: value.id, result: {} })}\n`),
				);
			if (value.method === "account/read")
				queueMicrotask(() =>
					output.write(
						`${JSON.stringify({ id: value.id, result: { account: null } })}\n`,
					),
				);
			callback();
		},
	});
	const process = Object.assign(child, {
		stdin: input,
		stdout: output,
		stderr: new PassThrough(),
		kill: () => {
			killed = true;
			return true;
		},
	}) as unknown as ChildProcessWithoutNullStreams;
	return { process, output, requests, killed: () => killed };
}
test("official initialize handshake precedes account RPC and unsolicited approval is denied", async () => {
	const fake = fixture();
	const rpc = new CodexAppServer(() => fake.process);
	expect(await rpc.request("account/read", { refreshToken: false })).toEqual({
		account: null,
	});
	expect(fake.requests.map((item) => item.method)).toEqual([
		"initialize",
		"initialized",
		"account/read",
	]);
	fake.output.write(
		`${JSON.stringify({ id: "approval", method: "item/commandExecution/requestApproval", params: {} })}\n`,
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fake.requests.at(-1)).toMatchObject({
		id: "approval",
		error: { code: -32601 },
	});
	rpc.close();
	expect(fake.killed()).toBe(true);
});
test("missing protocol reply times out and closes the process", async () => {
	const fake = fixture();
	const rpc = new CodexAppServer(() => fake.process, 5);
	await expect(rpc.request("unknown/noReply", {})).rejects.toThrow("timed out");
	expect(fake.killed()).toBe(true);
});
test("process death rejects pending requests without logging stderr", async () => {
	const fake = fixture();
	const rpc = new CodexAppServer(() => fake.process);
	await rpc.request("account/read", {});
	const pending = rpc.request("unknown/noReply", {});
	await new Promise((resolve) => setTimeout(resolve, 0));
	fake.process.emit("exit", 1);
	await expect(pending).rejects.toThrow("exited");
	rpc.close();
});
