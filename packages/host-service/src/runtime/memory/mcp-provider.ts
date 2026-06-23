import type {
	MemoryDataProvider,
	MemoryPlaybookDetail,
	MemoryPracticeResult,
	MemorySearchInput,
	MemorySearchResult,
} from "@superset/mcp/memory";
import { createMemoryMcpServer } from "@superset/mcp/memory";
import type { AreaTag } from "@superset/memory";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { memoryPlaybooks } from "../../db/schema.ts";
import type { MemoryRetrieveService } from "./retrieve-service.ts";

/**
 * Host-side `MemoryDataProvider` for the LOCAL memory MCP server (B4). Adapts
 * the retrieval/telemetry service + the playbook table to the provider contract
 * `@superset/mcp/memory` defines. Egress-free — reads only the local host
 * SQLite memory tables. The same bundle is produced as `memory.retrieve`, so an
 * agent pulling over MCP gets exactly what the tRPC path returns.
 */
export class HostMemoryDataProvider implements MemoryDataProvider {
	private readonly db: HostDb;
	private readonly retrieve: MemoryRetrieveService;

	constructor(options: { db: HostDb; retrieve: MemoryRetrieveService }) {
		this.db = options.db;
		this.retrieve = options.retrieve;
	}

	async search(input: MemorySearchInput): Promise<MemorySearchResult> {
		const bundle = this.retrieve.retrieve({
			projectId: input.projectId ?? null,
			intent: input.intent,
			areaTags: input.areaTags as AreaTag[] | undefined,
			topKPlaybooks: input.topKPlaybooks,
			topKIndexSlices: input.topKIndexSlices,
			maxTokens: input.maxTokens,
			includeProvisional: input.includeProvisional ?? false,
		});
		return {
			queryAreas: bundle.queryAreas,
			practices: bundle.practices.map((p) => ({
				scope: p.scope,
				content: p.content,
				version: p.version,
			})),
			playbooks: bundle.playbooks.map((p) => ({
				id: p.id,
				intent: p.intent,
				areaTags: p.areaTags,
				commands: p.commands,
				gotcha: p.gotcha,
				diffShape: p.diffShape,
				validation: p.validation,
				status: p.status,
				confidence: p.confidence,
				score: p.score,
			})),
			indexSlices: bundle.indexSlices.map((s) => ({
				path: s.path,
				areaTags: s.areaTags,
				summary: s.summary,
				score: s.score,
			})),
			estimatedTokens: bundle.estimatedTokens,
			trimmed: bundle.trimmed,
		};
	}

	async getPlaybook(input: {
		id: string;
	}): Promise<MemoryPlaybookDetail | null> {
		const row = this.db
			.select()
			.from(memoryPlaybooks)
			.where(eq(memoryPlaybooks.id, input.id))
			.get();
		if (!row) return null;
		return {
			id: row.id,
			projectId: row.projectId,
			intent: row.intent,
			touchedPaths: parseStringArray(row.touchedPathsJson),
			areaTags: parseStringArray(row.areaTagsJson),
			commands: parseStringArray(row.commandsJson),
			gotcha: row.gotcha,
			diffShape: row.diffShape,
			validation: row.validation,
			status: row.status,
			confidence: row.confidence,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	async getPractice(input: {
		scope: "project" | "global";
		projectId?: string | null;
	}): Promise<MemoryPracticeResult> {
		const version = this.retrieve.readPracticeVersion({
			scope: input.scope,
			projectId: input.scope === "global" ? null : (input.projectId ?? null),
		});
		return {
			scope: input.scope,
			projectId: input.scope === "global" ? null : (input.projectId ?? null),
			version: version?.version ?? null,
			content: version?.content ?? null,
		};
	}
}

/**
 * Build a local memory MCP server wired to the host's memory tables. Callers
 * connect a client over a local transport (e.g. `createInMemoryMemoryMcpClient`
 * or a stdio transport) — no network egress.
 */
export function createHostMemoryMcpServer(options: {
	db: HostDb;
	retrieve: MemoryRetrieveService;
}) {
	const provider = new HostMemoryDataProvider({
		db: options.db,
		retrieve: options.retrieve,
	});
	return createMemoryMcpServer(provider);
}

function parseStringArray(value: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((item): item is string => typeof item === "string");
}
