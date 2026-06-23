import { randomUUID } from "node:crypto";
import {
	type AreaTag,
	assembleRetrievalBundle,
	computeSavedStats,
	type MemoryTelemetrySample,
	type Playbook,
	type PlaybookProvenance,
	type PlaybookStatus,
	type PracticeScope,
	type PracticeSlice,
	type PracticeVersion,
	type ProjectIndexEntry,
	type RetrievalBundle,
	type SavedStat,
} from "@superset/memory";
import { and, desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	memoryProjectIndex,
	memoryTelemetry,
} from "../../db/schema.ts";

/**
 * Retrieval + telemetry service (B4 host half). Reads the memory tables, builds
 * the high-signal bundle via the pure `@superset/memory` assembler, and records
 * a token-savings telemetry sample. Shared by the `memory.retrieve` tRPC
 * procedure AND the local memory MCP server, so the bundle is identical whether
 * an agent pulls over MCP or the renderer queries tRPC. Local-only, no network.
 */

export interface RetrieveInput {
	projectId: string | null;
	intent: string;
	areaTags?: readonly AreaTag[];
	topKPlaybooks?: number;
	topKIndexSlices?: number;
	maxTokens?: number;
	/** Include provisional (not-yet-merged) playbooks. Default false. */
	includeProvisional?: boolean;
	/** Record a telemetry sample for this retrieval. Default true. */
	recordTelemetry?: boolean;
}

export interface RetrieveResult extends RetrievalBundle {
	projectId: string | null;
	intent: string;
}

const ALL_AREA_TAGS = new Set<string>([
	"frontend",
	"backend",
	"schema",
	"design-system",
	"desktop",
	"mobile",
	"marketing",
	"admin",
	"docs",
	"auth",
	"trpc",
	"mcp",
	"shared",
	"scripts",
	"tooling",
	"memory",
	"tests",
	"config",
	"other",
]);

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

function parseAreaTags(value: string): AreaTag[] {
	return parseStringArray(value).filter((item): item is AreaTag =>
		ALL_AREA_TAGS.has(item),
	);
}

function parseProvenance(value: string): PlaybookProvenance {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return { prNumber: null, url: null, taskId: null };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { prNumber: null, url: null, taskId: null };
	}
	const obj = parsed as Record<string, unknown>;
	return {
		prNumber: typeof obj.prNumber === "number" ? obj.prNumber : null,
		url: typeof obj.url === "string" ? obj.url : null,
		taskId: typeof obj.taskId === "string" ? obj.taskId : null,
	};
}

function rowToPlaybook(row: typeof memoryPlaybooks.$inferSelect): Playbook {
	return {
		id: row.id,
		projectId: row.projectId,
		intent: row.intent,
		touchedPaths: parseStringArray(row.touchedPathsJson),
		areaTags: parseAreaTags(row.areaTagsJson),
		commands: parseStringArray(row.commandsJson),
		gotcha: row.gotcha,
		diffShape: row.diffShape,
		validation: row.validation,
		status: row.status as PlaybookStatus,
		confidence: row.confidence,
		provenance: parseProvenance(row.provenanceJson),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class MemoryRetrieveService {
	private readonly db: HostDb;

	constructor(options: { db: HostDb }) {
		this.db = options.db;
	}

	/** Read the latest practice version for a scope (null when none). */
	readPracticeVersion(options: {
		scope: PracticeScope;
		projectId: string | null;
	}): PracticeVersion | null {
		const { scope, projectId } = options;
		const where =
			scope === "global"
				? eq(memoryPracticeVersions.scope, "global")
				: projectId === null
					? eq(memoryPracticeVersions.scope, "project")
					: and(
							eq(memoryPracticeVersions.scope, "project"),
							eq(memoryPracticeVersions.projectId, projectId),
						);
		const row = this.db
			.select()
			.from(memoryPracticeVersions)
			.where(where)
			.orderBy(desc(memoryPracticeVersions.version))
			.get();
		if (!row) return null;
		return {
			id: row.id,
			scope: row.scope as PracticeScope,
			projectId: row.projectId,
			version: row.version,
			content: row.content,
			provenance: row.provenance,
			createdAt: row.createdAt,
		};
	}

	private loadPlaybooks(options: {
		projectId: string | null;
		includeProvisional: boolean;
	}): Playbook[] {
		const filters = [];
		if (options.projectId !== null) {
			filters.push(eq(memoryPlaybooks.projectId, options.projectId));
		}
		const where =
			filters.length === 0
				? undefined
				: filters.length === 1
					? filters[0]
					: and(...filters);
		const rows = this.db
			.select()
			.from(memoryPlaybooks)
			.where(where)
			.orderBy(desc(memoryPlaybooks.updatedAt))
			.all();
		const statuses = options.includeProvisional
			? new Set<PlaybookStatus>(["confirmed", "provisional"])
			: new Set<PlaybookStatus>(["confirmed"]);
		return rows
			.map(rowToPlaybook)
			.filter((playbook) => statuses.has(playbook.status));
	}

	private loadIndexEntries(projectId: string | null): ProjectIndexEntry[] {
		if (projectId === null) return [];
		const rows = this.db
			.select()
			.from(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, projectId))
			.all();
		return rows.map((row) => ({
			id: row.id,
			projectId: row.projectId,
			path: row.path,
			kind: row.kind,
			areaTags: parseAreaTags(row.areaTagsJson),
			summary: row.summary,
			fingerprintId: row.fingerprintId,
			updatedAt: row.updatedAt,
		}));
	}

	private loadPractices(projectId: string | null): PracticeSlice[] {
		const slices: PracticeSlice[] = [];
		if (projectId !== null) {
			const project = this.readPracticeVersion({ scope: "project", projectId });
			if (project) {
				slices.push({
					scope: "project",
					content: project.content,
					version: project.version,
				});
			}
		}
		const global = this.readPracticeVersion({
			scope: "global",
			projectId: null,
		});
		if (global) {
			slices.push({
				scope: "global",
				content: global.content,
				version: global.version,
			});
		}
		return slices;
	}

	/**
	 * Assemble the retrieval bundle for an intent and (by default) record a
	 * telemetry sample of the tokens injected. Pure assembly is delegated to
	 * `@superset/memory`; this method only loads + records.
	 */
	retrieve(input: RetrieveInput): RetrieveResult {
		const {
			projectId,
			intent,
			areaTags,
			topKPlaybooks,
			topKIndexSlices,
			maxTokens,
			includeProvisional = false,
			recordTelemetry = true,
		} = input;

		const playbooks = this.loadPlaybooks({ projectId, includeProvisional });
		const indexEntries = this.loadIndexEntries(projectId);
		const practices = this.loadPractices(projectId);

		const bundle = assembleRetrievalBundle({
			intent,
			explicitAreas: areaTags,
			playbooks,
			indexEntries,
			practices,
			topKPlaybooks,
			topKIndexSlices,
			maxTokens,
		});

		if (recordTelemetry) {
			// Record the tokens INJECTED by this retrieval. A baseline (the tokens
			// the agent would have spent exploring without memory) is supplied by
			// the caller via `telemetry.record` when known; here we log the bundle
			// cost so the panel can chart injection volume even pre-baseline.
			this.recordSample({
				projectId,
				taskId: null,
				metric: "retrieval_tokens",
				baselineValue: null,
				observedValue: bundle.estimatedTokens,
			});
		}

		return { ...bundle, projectId, intent };
	}

	recordSample(sample: {
		projectId: string | null;
		taskId: string | null;
		metric: string;
		baselineValue: number | null;
		observedValue: number;
	}): string {
		const id = randomUUID();
		this.db
			.insert(memoryTelemetry)
			.values({
				id,
				projectId: sample.projectId,
				taskId: sample.taskId,
				metric: sample.metric,
				baselineValue: sample.baselineValue,
				observedValue: sample.observedValue,
			})
			.run();
		return id;
	}

	/** Compute "memory saved ~X%" stats from recorded telemetry (B4 panel). */
	savedStats(options: {
		projectId: string | null;
		limit?: number;
	}): SavedStat[] {
		const where =
			options.projectId !== null
				? eq(memoryTelemetry.projectId, options.projectId)
				: undefined;
		const rows = this.db
			.select()
			.from(memoryTelemetry)
			.where(where)
			.orderBy(desc(memoryTelemetry.createdAt))
			.limit(options.limit ?? 500)
			.all();
		const samples: MemoryTelemetrySample[] = rows.map((row) => ({
			id: row.id,
			projectId: row.projectId,
			taskId: row.taskId,
			metric: row.metric,
			baselineValue: row.baselineValue,
			observedValue: row.observedValue,
			createdAt: row.createdAt,
		}));
		return computeSavedStats(samples);
	}
}
