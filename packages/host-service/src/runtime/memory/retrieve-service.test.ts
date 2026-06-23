import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInMemoryMemoryMcpClient } from "@superset/mcp/memory";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	memoryProjectIndex,
	projects,
} from "../../db/schema";
import { HostMemoryDataProvider } from "./mcp-provider.ts";
import { MemoryRetrieveService } from "./retrieve-service.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("MemoryRetrieveService (B4 host)", () => {
	let db: HostDb;
	let homeDir: string;
	let prevHomeEnv: string | undefined;
	const projectId = "proj-retrieve";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
		homeDir = mkdtempSync(join(tmpdir(), "memory-retrieve-home-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function seedPlaybook(
		overrides: Partial<typeof memoryPlaybooks.$inferInsert>,
	) {
		const id = overrides.id ?? crypto.randomUUID();
		db.insert(memoryPlaybooks)
			.values({
				id,
				projectId,
				intent: "do backend work",
				touchedPathsJson: JSON.stringify(["packages/host-service/src/x.ts"]),
				areaTagsJson: JSON.stringify(["backend"]),
				commandsJson: JSON.stringify(["bun test"]),
				gotcha: null,
				diffShape: null,
				validation: "green",
				status: "confirmed",
				confidence: 80,
				provenanceJson: "{}",
				...overrides,
			})
			.run();
		return id;
	}

	it("assembles a bundle: practice + area-filtered playbooks + index slices", async () => {
		seedPlaybook({
			id: "pb-backend",
			areaTagsJson: JSON.stringify(["backend"]),
		});
		seedPlaybook({
			id: "pb-frontend",
			areaTagsJson: JSON.stringify(["frontend"]),
			intent: "frontend work",
		});
		db.insert(memoryProjectIndex)
			.values({
				id: "idx1",
				projectId,
				path: "packages/host-service/src/x.ts",
				kind: "file",
				areaTagsJson: JSON.stringify(["backend"]),
				summary: "[backend] exports: handler",
				fingerprintId: null,
			})
			.run();
		db.insert(memoryPracticeVersions)
			.values({
				id: "pv1",
				scope: "project",
				projectId,
				version: 1,
				content: "use object params",
				provenance: null,
			})
			.run();

		const service = new MemoryRetrieveService({ db });
		const bundle = await service.retrieve({
			projectId,
			intent: "work on the backend route",
		});

		expect(bundle.queryAreas).toContain("backend");
		expect(bundle.playbooks.map((p) => p.id)).toContain("pb-backend");
		expect(bundle.playbooks.map((p) => p.id)).not.toContain("pb-frontend");
		expect(bundle.indexSlices.some((s) => s.path.endsWith("x.ts"))).toBe(true);
		expect(bundle.practices.some((p) => p.scope === "project")).toBe(true);
	});

	it("excludes provisional playbooks unless asked", async () => {
		seedPlaybook({ id: "prov", status: "provisional" });
		const service = new MemoryRetrieveService({ db });
		expect(
			(await service.retrieve({ projectId, intent: "backend" })).playbooks.some(
				(p) => p.id === "prov",
			),
		).toBe(false);
		expect(
			(
				await service.retrieve({
					projectId,
					intent: "backend",
					includeProvisional: true,
				})
			).playbooks.some((p) => p.id === "prov"),
		).toBe(true);
	});

	it("records a retrieval_tokens telemetry sample by default", async () => {
		seedPlaybook({ id: "pb1" });
		const service = new MemoryRetrieveService({ db });
		await service.retrieve({ projectId, intent: "backend" });
		const stats = service.savedStats({ projectId });
		// retrieval_tokens has no baseline → 0% saved but the sample exists.
		expect(stats.some((s) => s.metric === "retrieval_tokens")).toBe(true);
	});

	it("computes savedStats percentage from baseline+observed samples", () => {
		const service = new MemoryRetrieveService({ db });
		service.recordSample({
			projectId,
			taskId: null,
			metric: "tokens",
			baselineValue: 1000,
			observedValue: 700,
		});
		const tokens = service
			.savedStats({ projectId })
			.find((s) => s.metric === "tokens");
		expect(tokens?.savedPercent).toBe(30);
	});

	it("serves the same bundle over the local memory MCP server", async () => {
		seedPlaybook({ id: "pb-mcp", areaTagsJson: JSON.stringify(["backend"]) });
		const service = new MemoryRetrieveService({ db });
		const provider = new HostMemoryDataProvider({ db, retrieve: service });
		const { client, cleanup } = await createInMemoryMemoryMcpClient(provider);
		try {
			const res = await client.callTool({
				name: "memory_search",
				arguments: { intent: "backend route", projectId },
			});
			const structured = res.structuredContent as {
				playbooks: Array<{ id: string }>;
			};
			expect(structured.playbooks.some((p) => p.id === "pb-mcp")).toBe(true);

			const detail = await client.callTool({
				name: "memory_get_playbook",
				arguments: { id: "pb-mcp" },
			});
			const detailStructured = detail.structuredContent as {
				playbook: { id: string; touchedPaths: string[] };
			};
			expect(detailStructured.playbook.id).toBe("pb-mcp");
		} finally {
			await cleanup();
		}
	});
});
