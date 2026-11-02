import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import test from "node:test";

// Run with Node: Bun uses its own fetch and would not exercise the SDK's
// Node-only Undici Agent/dispatcher path. No provider or account is contacted.
test(
	"AI SDK 3 keeps its HTTP and download guards with patched Undici",
	{
		skip: !!process.versions.bun,
	},
	async (t) => {
		const hostRequire = createRequire(
			new URL("../../package.json", import.meta.url),
		);
		const coreRequire = createRequire(hostRequire.resolve("@mastra/core"));
		const utilsPath = coreRequire.resolve("@ai-sdk/provider-utils-v5");
		const sdk = coreRequire("@ai-sdk/provider-utils-v5");
		const sdkRequire = createRequire(utilsPath);
		assert.match(sdkRequire("undici/package.json").version, /^6\./);
		const requests = [];
		const server = createServer(async (request, response) => {
			requests.push(request.url);
			if (request.url === "/redirect") {
				response.writeHead(302, { location: "http://127.0.0.1/private" });
				response.end();
				return;
			}
			let body = "";
			for await (const chunk of request) body += chunk;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ body, probe: request.headers["x-probe"] }));
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const port = server.address().port;
		const originalConnect = net.connect;
		// Route a public-IP fixture URL into the local test server. This preserves
		// the real SDK, Agent and fetch implementations while forbidding Internet I/O.
		net.connect = (options) => {
			assert.equal(options.host, "93.184.216.34");
			return originalConnect.call(net, { ...options, host: "127.0.0.1", port });
		};
		t.after(async () => {
			net.connect = originalConnect;
			server.closeAllConnections();
			await new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		});
		const base = `http://93.184.216.34:${port}`;
		await t.test(
			"real Agent/fetch preserves request headers, body and response",
			async () => {
				const response = await sdk.fetchWithValidatedEndpoint({
					url: new URL(`${base}/payload`),
					init: {
						method: "POST",
						headers: { "x-probe": "present" },
						body: "payload",
					},
				});
				assert.equal(response.status, 200);
				assert.deepEqual(await response.json(), {
					body: "payload",
					probe: "present",
				});
			},
		);
		await t.test("private endpoints remain blocked", async () => {
			await assert.rejects(
				sdk.fetchWithValidatedEndpoint({
					url: new URL("http://127.0.0.1/private"),
				}),
			);
			assert.ok(!requests.includes("/private"));
		});
		await t.test(
			"redirects cannot bypass private-address validation",
			async () => {
				await assert.rejects(
					sdk.fetchWithValidatedRedirects({ url: `${base}/redirect` }),
				);
				assert.ok(requests.includes("/redirect"));
				assert.ok(!requests.includes("/private"));
			},
		);
		await t.test("cancellation still rejects", async () => {
			const controller = new AbortController();
			controller.abort();
			await assert.rejects(
				sdk.fetchWithValidatedEndpoint({
					url: new URL(`${base}/cancel`),
					init: { signal: controller.signal },
				}),
			);
		});
	},
);
