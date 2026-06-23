import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { memoryPlaybooks, projects } from "../../db/schema";
import { MEMORY_MCP_ROUTE_PATH, registerMemoryMcpRoute } from "./mcp-route.ts";
import { MemoryRetrieveService } from "./retrieve-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/**
 * Wave-4 A1(a): the loopback memory MCP route. Proves an EXTERNAL MCP client
 * (the same SDK Client a CLI agent uses) can connect over Streamable HTTP and
 * call the memory tools — driven through the in-process Hono app (no real port).
 */
describe("memory MCP loopback route (wave-4 A1a)", () => {
	let db: HostDb;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "proj-mcp-route";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
		homeDir = mkdtempSync(join(tmpdir(), "memory-mcp-route-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function buildApp(): Hono {
		const retrieve = new MemoryRetrieveService({ db });
		const app = new Hono();
		registerMemoryMcpRoute({ app, db, retrieve });
		return app;
	}

	/**
	 * Connect a real MCP `Client` to the route via `StreamableHTTPClientTransport`
	 * with a `fetch` that routes into the in-process Hono app — exactly how an
	 * external CLI agent would reach the loopback endpoint, minus the socket.
	 */
	async function connectClient(
		app: Hono,
	): Promise<{ client: Client; cleanup: () => Promise<void> }> {
		const transport = new StreamableHTTPClientTransport(
			new URL(`http://host.test${MEMORY_MCP_ROUTE_PATH}`),
			{
				fetch: ((input: string | URL | Request, init?: RequestInit) => {
					const request =
						input instanceof Request
							? input
							: new Request(input.toString(), init);
					return app.fetch(request);
				}) as typeof fetch,
			},
		);
		const client = new Client({ name: "external-cli-agent", version: "0.0.0" });
		await client.connect(transport);
		return {
			client,
			cleanup: async () => {
				await client.close();
			},
		};
	}

	it("exposes the three memory tools to a connecting MCP client", async () => {
		const app = buildApp();
		const { client, cleanup } = await connectClient(app);
		try {
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name).sort();
			expect(names).toEqual([
				"memory_get_playbook",
				"memory_get_practice",
				"memory_search",
			]);
		} finally {
			await cleanup();
		}
	});

	it("serves memory_search over the loopback transport", async () => {
		db.insert(memoryPlaybooks)
			.values({
				id: "pb-route-1",
				projectId,
				intent: "wire the host memory MCP route",
				touchedPathsJson: JSON.stringify(["packages/host-service/src/app.ts"]),
				areaTagsJson: JSON.stringify(["backend"]),
				commandsJson: JSON.stringify(["bun test packages/host-service"]),
				gotcha: null,
				diffShape: null,
				validation: "tests green",
				status: "confirmed",
				confidence: 80,
				provenanceJson: JSON.stringify({
					prNumber: null,
					url: null,
					taskId: null,
				}),
			})
			.run();

		const app = buildApp();
		const { client, cleanup } = await connectClient(app);
		try {
			const result = await client.callTool({
				name: "memory_search",
				arguments: { projectId, intent: "wire the host memory route" },
			});
			const text = JSON.stringify(result);
			expect(text).toContain("wire the host memory MCP route");
		} finally {
			await cleanup();
		}
	});

	it("mounts at the documented loopback path", () => {
		expect(MEMORY_MCP_ROUTE_PATH).toBe("/mcp/memory");
	});
});
