import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects } from "../../db/schema";
import {
	createOllamaEmbeddingsClient,
	type EmbeddingsClient,
	MemoryEmbeddingsService,
} from "./embeddings-service.ts";
import { MemoryRetrieveService } from "./retrieve-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** Deterministic stub client: counts detect/embed calls; embeds by char codes. */
function stubClient(): EmbeddingsClient & {
	detectCalls: number;
	embedCalls: number;
} {
	const state = { detectCalls: 0, embedCalls: 0 };
	return {
		get detectCalls() {
			return state.detectCalls;
		},
		get embedCalls() {
			return state.embedCalls;
		},
		async detect() {
			state.detectCalls += 1;
			return { available: true, model: "stub-embed" };
		},
		async embed({ text }) {
			state.embedCalls += 1;
			// 8-dim vector from char-code buckets so similar text → similar vector.
			const v = new Array(8).fill(0);
			for (let i = 0; i < text.length; i++) {
				v[text.charCodeAt(i) % 8] += 1;
			}
			return v;
		},
	};
}

describe("MemoryEmbeddingsService (B7a)", () => {
	let db: HostDb;
	let repoPath: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "proj-embed";

	beforeEach(() => {
		db = buildDb();
		repoPath = mkdtempSync(join(tmpdir(), "embed-repo-"));
		db.insert(projects).values({ id: projectId, repoPath }).run();
		homeDir = mkdtempSync(join(tmpdir(), "embed-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
		mkdirSync(join(repoPath, "src"), { recursive: true });
		writeFileSync(join(repoPath, "src/alpha.ts"), "export const alpha = 1;\n");
		writeFileSync(join(repoPath, "src/beta.ts"), "export const beta = 2;\n");
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(repoPath, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("is OFF by default with default settings", () => {
		const service = new MemoryEmbeddingsService({ db, client: stubClient() });
		const settings = service.readSettings();
		expect(settings.enabled).toBe(false);
		expect(settings.endpoint).toBe("http://127.0.0.1:11434");
	});

	it("makes ZERO network calls when DISABLED (status, reindex, search)", async () => {
		const client = stubClient();
		const service = new MemoryEmbeddingsService({ db, client });

		const status = await service.status(projectId);
		expect(status.enabled).toBe(false);
		expect(status.available).toBe(false);

		const reindex = await service.reindex(projectId);
		expect(reindex).toEqual({ embedded: 0, evicted: 0, skipped: true });

		const search = await service.semanticSearch({
			projectId,
			query: "alpha",
		});
		expect(search).toEqual([]);

		// The injected client was NEVER consulted while disabled.
		expect(client.detectCalls).toBe(0);
		expect(client.embedCalls).toBe(0);
	});

	it("REFUSES to persist a non-loopback endpoint", () => {
		const service = new MemoryEmbeddingsService({ db, client: stubClient() });
		expect(() =>
			service.setSettings({ enabled: true, endpoint: "http://evil.com" }),
		).toThrow(/loopback/i);
	});

	it("detect skips the network entirely for a non-loopback endpoint", async () => {
		const client = stubClient();
		const service = new MemoryEmbeddingsService({ db, client });
		const result = await service.detect({ endpoint: "http://10.0.0.5:11434" });
		expect(result.available).toBe(false);
		expect(client.detectCalls).toBe(0);
	});

	it("embeds files when enabled+available and reuses unchanged files (incremental)", async () => {
		const client = stubClient();
		const service = new MemoryEmbeddingsService({ db, client });
		service.setSettings({ enabled: true });

		const first = await service.reindex(projectId);
		expect(first.skipped).toBe(false);
		expect(first.embedded).toBe(2); // alpha + beta
		const afterFirst = client.embedCalls;

		// Re-index with NO changes → nothing re-embedded (fingerprint match).
		const second = await service.reindex(projectId);
		expect(second.embedded).toBe(0);
		expect(client.embedCalls).toBe(afterFirst);

		// Change one file → only that file re-embeds.
		writeFileSync(
			join(repoPath, "src/alpha.ts"),
			"export const alpha = 999;\n",
		);
		const third = await service.reindex(projectId);
		expect(third.embedded).toBe(1);
		expect(client.embedCalls).toBe(afterFirst + 1);
	});

	it("evicts vectors for deleted files on reindex", async () => {
		const service = new MemoryEmbeddingsService({ db, client: stubClient() });
		service.setSettings({ enabled: true });
		await service.reindex(projectId);
		expect((await service.status(projectId)).embeddedCount).toBe(2);

		rmSync(join(repoPath, "src/beta.ts"));
		const result = await service.reindex(projectId);
		expect(result.evicted).toBe(1);
		expect((await service.status(projectId)).embeddedCount).toBe(1);
	});

	it("semanticSearch returns cosine-ranked matches when enabled", async () => {
		const service = new MemoryEmbeddingsService({ db, client: stubClient() });
		service.setSettings({ enabled: true });
		await service.reindex(projectId);

		const matches = await service.semanticSearch({
			projectId,
			query: "export const alpha = 1;",
			topK: 1,
			minScore: -1,
		});
		expect(matches).toHaveLength(1);
		expect(matches[0]?.path).toBe("src/alpha.ts");
	});
});

describe("createOllamaEmbeddingsClient (loopback hard-gate)", () => {
	it("never calls fetch for a non-loopback endpoint", async () => {
		let fetchCalls = 0;
		const fetchImpl = (async () => {
			fetchCalls += 1;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;
		const client = createOllamaEmbeddingsClient({ fetchImpl });

		const detect = await client.detect({ endpoint: "https://api.openai.com" });
		expect(detect.available).toBe(false);
		await expect(
			client.embed({
				endpoint: "https://api.openai.com",
				model: "m",
				text: "x",
			}),
		).rejects.toThrow(/non-local/i);

		expect(fetchCalls).toBe(0);
	});

	it("calls the injected fetch for a loopback endpoint", async () => {
		let lastUrl = "";
		const fetchImpl = (async (url: string) => {
			lastUrl = url;
			return new Response(JSON.stringify({ models: [{ name: "m1" }] }), {
				status: 200,
			});
		}) as unknown as typeof fetch;
		const client = createOllamaEmbeddingsClient({ fetchImpl });
		const detect = await client.detect({ endpoint: "http://127.0.0.1:11434" });
		expect(detect.available).toBe(true);
		expect(detect.model).toBe("m1");
		expect(lastUrl).toBe("http://127.0.0.1:11434/api/tags");
	});
});

describe("retrieval blend (enabled vs off)", () => {
	let db: HostDb;
	let repoPath: string;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "proj-blend";

	beforeEach(() => {
		db = buildDb();
		repoPath = mkdtempSync(join(tmpdir(), "blend-repo-"));
		db.insert(projects).values({ id: projectId, repoPath }).run();
		homeDir = mkdtempSync(join(tmpdir(), "blend-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
		mkdirSync(join(repoPath, "src"), { recursive: true });
		writeFileSync(join(repoPath, "src/alpha.ts"), "export const alpha = 1;\n");
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(repoPath, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("OFF → no semantic slices, zero embed/detect calls", async () => {
		const client = stubClient();
		const embeddings = new MemoryEmbeddingsService({ db, client });
		const retrieve = new MemoryRetrieveService({ db, embeddings });

		const bundle = await retrieve.retrieve({
			projectId,
			intent: "alpha",
			recordTelemetry: false,
		});
		expect(bundle.semanticSlices).toEqual([]);
		expect(client.detectCalls).toBe(0);
		expect(client.embedCalls).toBe(0);
	});

	it("ENABLED → semantic slices blended into the bundle", async () => {
		const client = stubClient();
		const embeddings = new MemoryEmbeddingsService({ db, client });
		embeddings.setSettings({ enabled: true });
		await embeddings.reindex(projectId);

		const retrieve = new MemoryRetrieveService({ db, embeddings });
		const bundle = await retrieve.retrieve({
			projectId,
			intent: "export const alpha = 1;",
			recordTelemetry: false,
		});
		expect(bundle.semanticSlices.length).toBeGreaterThan(0);
		expect(bundle.semanticSlices.some((s) => s.path === "src/alpha.ts")).toBe(
			true,
		);
	});
});
