import { expect, test } from "bun:test";
import { INPUT_LIMITS } from "./input-limits";
import { limitJsonRequest } from "./request-limits";

function post(value: unknown, path = "ticketRun.start") {
	return new Request(`http://localhost/trpc/${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "test" },
		body: JSON.stringify(value),
	});
}
test("keeps ordinary JSON, headers and query intact", async () => {
	const input = { json: { repos: [{ projectId: "p" }] }, meta: { values: {} } };
	const result = await limitJsonRequest(post(input, "ticketRun.start?batch=1"));
	expect(result).toBeInstanceOf(Request);
	if (!(result instanceof Request)) throw new Error("unexpected rejection");
	expect(await result.json()).toEqual(input);
	expect(result.headers.get("authorization")).toBe("test");
	expect(new URL(result.url).search).toBe("?batch=1");
});
test("rejects declared oversize without reading body", async () => {
	const req = post({});
	req.headers.set("content-length", String(INPUT_LIMITS.requestBytes + 1));
	const result = await limitJsonRequest(req);
	expect(result).toBeInstanceOf(Response);
	expect((result as Response).status).toBe(413);
	expect(req.bodyUsed).toBe(false);
});
test("counts chunked bytes despite a false Content-Length and cancels early", async () => {
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(INPUT_LIMITS.requestBytes));
			controller.enqueue(new Uint8Array(1));
		},
		cancel() {
			cancelled = true;
		},
	});
	const req = new Request("http://localhost/trpc/test", {
		method: "POST",
		headers: { "content-length": "1" },
		body: stream,
		duplex: "half",
	} as RequestInit);
	const result = await limitJsonRequest(req);
	expect((result as Response).status).toBe(413);
	expect(cancelled).toBe(true);
});
test("ordinary body exact byte boundary succeeds and one more byte fails", async () => {
	const body = JSON.stringify({
		value: "x".repeat(INPUT_LIMITS.requestBytes - 12),
	});
	expect(new TextEncoder().encode(body).length).toBe(INPUT_LIMITS.requestBytes);
	expect(
		await limitJsonRequest(
			new Request("http://localhost/trpc/test", { method: "POST", body }),
		),
	).toBeInstanceOf(Request);
	expect(
		(
			(await limitJsonRequest(
				new Request("http://localhost/trpc/test", {
					method: "POST",
					body: `${body} `,
				}),
			)) as Response
		).status,
	).toBe(413);
});
test("retains a full 25 MiB decoded upload with base64/JSON overhead", async () => {
	const data = "A".repeat(4 * Math.ceil((25 * 1024 * 1024) / 3));
	const result = await limitJsonRequest(
		post(
			{ json: { data: { kind: "base64", data }, mediaType: "image/png" } },
			"attachments.upload",
		),
	);
	expect(result).toBeInstanceOf(Request);
	if (!(result instanceof Request)) throw new Error("upload rejected");
	expect(
		((await result.json()) as { json: { data: { data: string } } }).json.data
			.data.length,
	).toBe(data.length);
});
test("chat send/restart share the attachment envelope, regular calls do not", async () => {
	const payload = {
		content: "hi",
		files: [
			{ data: "x".repeat(INPUT_LIMITS.requestBytes), mediaType: "text/plain" },
		],
	};
	for (const path of ["chat.sendMessage", "session.restartFromMessage"])
		expect(await limitJsonRequest(post({ payload }, path))).toBeInstanceOf(
			Request,
		);
	expect(
		((await limitJsonRequest(post({ payload }, "ticketRun.start"))) as Response)
			.status,
	).toBe(413);
});
test("bounds batches independently of body size and rejects encoded comma bypass", async () => {
	for (const separator of [",", "%2C"])
		expect(
			(
				(await limitJsonRequest(
					post({}, Array(33).fill("test").join(separator)),
				)) as Response
			).status,
		).toBe(413);
	expect(
		await limitJsonRequest(post({}, Array(32).fill("test").join(","))),
	).toBeInstanceOf(Request);
	expect(
		((await limitJsonRequest(post(Array(33).fill({})))) as Response).status,
	).toBe(413);
});
test("rejects large GET URLs and malformed/deep/huge-collection JSON before adapters", async () => {
	expect(
		(
			(await limitJsonRequest(
				new Request(
					`http://localhost/trpc/test?input=${"x".repeat(INPUT_LIMITS.urlBytes)}`,
				),
			)) as Response
		).status,
	).toBe(413);
	expect(
		(
			(await limitJsonRequest(
				new Request("http://localhost/trpc/test", {
					method: "POST",
					body: "{",
				}),
			)) as Response
		).status,
	).toBe(400);
	let value: unknown = 0;
	for (let i = 0; i < 34; i++) value = [value];
	expect(((await limitJsonRequest(post({ value }))) as Response).status).toBe(
		413,
	);
	expect(
		(
			(await limitJsonRequest(
				post({ values: Array(4097).fill(0) }),
			)) as Response
		).status,
	).toBe(413);
});
