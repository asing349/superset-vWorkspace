import { randomUUID } from "node:crypto";
import {
	type AreaTag,
	distillCapture,
	type MemoryGraph,
	type Playbook,
	type PlaybookProvenance,
	type PlaybookStatus,
	type PracticeDoc,
	type PracticeScope,
	type PracticeVersion,
	type ProjectIndexEntry,
	pathsToAreas,
	redactAll,
	redactText,
	type SavedStat,
} from "@superset/memory";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	memoryTelemetry,
	workspaces,
} from "../../../db/schema";
import {
	type ConsolidationProposal,
	ensureMemoryRootDir,
	gatherChangedFiles,
	type ProjectIndexStatus,
	type RegenerateVaultResult,
	type RetrieveResult,
} from "../../../runtime/memory";
import { protectedProcedure, queryProcedure, router } from "../../index";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const areaTagSchema = z.enum([
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
]) satisfies z.ZodType<AreaTag>;

const playbookStatusSchema = z.enum([
	"provisional",
	"confirmed",
	"demoted",
	"archived",
]) satisfies z.ZodType<PlaybookStatus>;

const practiceScopeSchema = z.enum([
	"project",
	"global",
]) satisfies z.ZodType<PracticeScope>;

const provenanceSchema = z.object({
	prNumber: z.number().int().nullable().default(null),
	url: z.string().nullable().default(null),
	taskId: z.string().nullable().default(null),
});

/**
 * The `capture` input — the SEAM B2 must call. B2 distills a finished session
 * into this already-distilled shape; B1's `capture` only validates, redacts,
 * and persists it as a `provisional` Playbook (it does NOT distill). `areaTags`
 * is optional: when omitted we derive it from `touchedPaths` via `pathsToAreas`
 * (B2 may also pass explicit task labels — they are merged with derived areas).
 */
const captureInputSchema = z.object({
	projectId: z.string().nullable().default(null),
	intent: z.string().min(1),
	touchedPaths: z.array(z.string()).default([]),
	areaTags: z.array(areaTagSchema).optional(),
	commands: z.array(z.string()).default([]),
	gotcha: z.string().nullable().default(null),
	diffShape: z.string().nullable().default(null),
	validation: z.string().nullable().default(null),
	provenance: provenanceSchema.default({
		prNumber: null,
		url: null,
		taskId: null,
	}),
});

export type MemoryCaptureInput = z.infer<typeof captureInputSchema>;

// ---------------------------------------------------------------------------
// Row <-> domain mappers
// ---------------------------------------------------------------------------

type PlaybookRow = typeof memoryPlaybooks.$inferSelect;
type PracticeVersionRow = typeof memoryPracticeVersions.$inferSelect;

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
	const valid = new Set(areaTagSchema.options);
	return parseStringArray(value).filter((item): item is AreaTag =>
		valid.has(item as AreaTag),
	);
}

function parseProvenance(value: string): PlaybookProvenance {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return { prNumber: null, url: null, taskId: null };
	}
	const result = provenanceSchema.safeParse(parsed);
	return result.success
		? result.data
		: { prNumber: null, url: null, taskId: null };
}

function toPlaybook(row: PlaybookRow): Playbook {
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

function toPracticeVersion(row: PracticeVersionRow): PracticeVersion {
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

function getPlaybookRow(db: HostDb, id: string): PlaybookRow | undefined {
	return db
		.select()
		.from(memoryPlaybooks)
		.where(eq(memoryPlaybooks.id, id))
		.get();
}

function readBackPlaybook(db: HostDb, id: string): Playbook {
	const row = getPlaybookRow(db, id);
	if (!row) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to read back memory playbook",
		});
	}
	return toPlaybook(row);
}

/**
 * Persist a provided, already-distilled capture input as a `provisional`
 * Playbook: redact free text, derive + merge area tags, insert, read back. The
 * single source of truth for capture persistence — both `capture` (caller
 * pre-distilled) and `captureFromPR` (host-distilled) funnel through here, so
 * redaction/area-tagging stays identical regardless of entry point.
 */
function persistCapture(db: HostDb, input: MemoryCaptureInput): Playbook {
	// Establish the on-disk memory root the first time we capture; the
	// vault/index writers (B3/B6) live there.
	ensureMemoryRootDir();

	const intent = redactText(input.intent).text;
	const touchedPaths = redactAll(input.touchedPaths);
	const commands = redactAll(input.commands);
	const gotcha = input.gotcha === null ? null : redactText(input.gotcha).text;
	const diffShape =
		input.diffShape === null ? null : redactText(input.diffShape).text;
	const validation =
		input.validation === null ? null : redactText(input.validation).text;

	// Derive areas from the (redacted) paths; merge any explicit labels the
	// caller passed. Paths are repo-relative so redaction rarely changes them,
	// but we derive from the post-redaction list to stay consistent with what
	// we persist.
	const derived = pathsToAreas(touchedPaths);
	const areaTags = input.areaTags
		? [...new Set([...input.areaTags, ...derived])]
		: derived;

	const id = randomUUID();
	db.insert(memoryPlaybooks)
		.values({
			id,
			projectId: input.projectId,
			intent,
			touchedPathsJson: JSON.stringify(touchedPaths),
			areaTagsJson: JSON.stringify(areaTags),
			commandsJson: JSON.stringify(commands),
			gotcha,
			diffShape,
			validation,
			status: "provisional",
			confidence: 0,
			provenanceJson: JSON.stringify(input.provenance),
		})
		.run();
	return readBackPlaybook(db, id);
}

export const memoryRouter = router({
	// --- Playbooks (REAL, table-backed) ------------------------------------

	/** List playbooks, optionally filtered by project and/or status. */
	listPlaybooks: queryProcedure
		.input(
			z
				.object({
					projectId: z.string().nullable().optional(),
					status: playbookStatusSchema.optional(),
				})
				.optional(),
		)
		.query(({ ctx, input }): Playbook[] => {
			const filters = [];
			if (input?.projectId !== undefined && input.projectId !== null) {
				filters.push(eq(memoryPlaybooks.projectId, input.projectId));
			}
			if (input?.status !== undefined) {
				filters.push(eq(memoryPlaybooks.status, input.status));
			}
			const where =
				filters.length === 0
					? undefined
					: filters.length === 1
						? filters[0]
						: and(...filters);
			const rows = ctx.db
				.select()
				.from(memoryPlaybooks)
				.where(where)
				.orderBy(desc(memoryPlaybooks.updatedAt))
				.all();
			return rows.map(toPlaybook);
		}),

	/** Read a single playbook by id. NOT_FOUND if missing. */
	getPlaybook: queryProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(({ ctx, input }): Playbook => {
			const row = getPlaybookRow(ctx.db, input.id);
			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Playbook not found: ${input.id}`,
				});
			}
			return toPlaybook(row);
		}),

	/**
	 * Persist a PROVIDED, already-distilled provisional Playbook. B1's job is
	 * only: validate (Zod) + REDACT free text + derive area tags + persist +
	 * return the row. The *distillation of a session into this input* is B2.
	 */
	capture: protectedProcedure
		.input(captureInputSchema)
		.mutation(({ ctx, input }): Playbook => persistCapture(ctx.db, input)),

	/**
	 * B2 — the PR-time "Save to memory?" entry point. The renderer hands us the
	 * `workspaceId` + the just-opened PR's metadata; the HOST distills the
	 * Playbook from LOCAL sources (the workspace git diff → touchedPaths +
	 * diffShape; the PR title/body → intent) with NO model and NO network, then
	 * persists it as a provisional Playbook. Keeps the renderer browser-safe:
	 * all fs/git work happens here, reached over tRPC.
	 */
	captureFromPR: protectedProcedure
		.input(
			z.object({
				workspaceId: z.string().min(1),
				projectId: z.string().nullable().default(null),
				prNumber: z.number().int().nullable().default(null),
				prUrl: z.string().nullable().default(null),
				prTitle: z.string().default(""),
				prBody: z.string().nullable().default(null),
				baseBranch: z.string().nullable().default(null),
				/** Commands proven to work this session, if the caller knows them. */
				commands: z.array(z.string()).default([]),
				/** How success was proven locally, if known. */
				validation: z.string().nullable().default(null),
				taskId: z.string().nullable().default(null),
			}),
		)
		.mutation(async ({ ctx, input }): Promise<Playbook> => {
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();
			if (!workspace?.worktreePath) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Workspace not found: ${input.workspaceId}`,
				});
			}

			// LOCAL/EGRESS-FREE: the only external read is the local git subprocess.
			const git = await ctx.git(workspace.worktreePath);
			const changedFiles = await gatherChangedFiles({
				git,
				baseBranch: input.baseBranch ?? undefined,
			});

			// Deterministic distillation (no model): shape the local diff + PR
			// metadata into the capture fields, then persist via the shared path.
			const distilled = distillCapture({
				prTitle: input.prTitle,
				prBody: input.prBody,
				changedFiles,
				commands: input.commands,
				validation: input.validation,
			});

			return persistCapture(ctx.db, {
				projectId: input.projectId ?? workspace.projectId ?? null,
				intent: distilled.intent,
				touchedPaths: distilled.touchedPaths,
				areaTags: distilled.areaTags,
				commands: distilled.commands,
				gotcha: distilled.gotcha,
				diffShape: distilled.diffShape,
				validation: distilled.validation,
				provenance: {
					prNumber: input.prNumber,
					url: input.prUrl,
					taskId: input.taskId,
				},
			});
		}),

	/**
	 * Promote a provisional playbook to confirmed (the free merge signal, A3),
	 * setting a confidence in [0,100]. Idempotent on an already-confirmed row.
	 */
	confirm: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				confidence: z.number().int().min(0).max(100).default(80),
			}),
		)
		.mutation(({ ctx, input }): Playbook => {
			const row = getPlaybookRow(ctx.db, input.id);
			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Playbook not found: ${input.id}`,
				});
			}
			ctx.db
				.update(memoryPlaybooks)
				.set({
					status: "confirmed",
					confidence: input.confidence,
					updatedAt: Date.now(),
				})
				.where(eq(memoryPlaybooks.id, input.id))
				.run();
			return readBackPlaybook(ctx.db, input.id);
		}),

	/**
	 * Demote a playbook (PR closed unmerged / branch dropped). Defaults to
	 * `demoted`; pass `archived` for a soft tombstone. Lowers confidence.
	 */
	demote: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				status: z
					.enum(["demoted", "archived"])
					.default("demoted") satisfies z.ZodType<"demoted" | "archived">,
			}),
		)
		.mutation(({ ctx, input }): Playbook => {
			const row = getPlaybookRow(ctx.db, input.id);
			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Playbook not found: ${input.id}`,
				});
			}
			ctx.db
				.update(memoryPlaybooks)
				.set({ status: input.status, confidence: 0, updatedAt: Date.now() })
				.where(eq(memoryPlaybooks.id, input.id))
				.run();
			return readBackPlaybook(ctx.db, input.id);
		}),

	/**
	 * Forget a playbook. By default a hard delete; pass `tombstone: true` to
	 * keep the row as `archived` (reversible-by-recapture per Idempotence).
	 */
	forget: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				tombstone: z.boolean().default(false),
			}),
		)
		.mutation(({ ctx, input }): { id: string; forgotten: boolean } => {
			const row = getPlaybookRow(ctx.db, input.id);
			if (!row) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Playbook not found: ${input.id}`,
				});
			}
			if (input.tombstone) {
				ctx.db
					.update(memoryPlaybooks)
					.set({ status: "archived", updatedAt: Date.now() })
					.where(eq(memoryPlaybooks.id, input.id))
					.run();
			} else {
				ctx.db
					.delete(memoryPlaybooks)
					.where(eq(memoryPlaybooks.id, input.id))
					.run();
			}
			return { id: input.id, forgotten: true };
		}),

	// --- Practice (REAL read; write is B5) ---------------------------------

	/**
	 * Read the latest Coding Practice version for a scope. Returns a
	 * `PracticeDoc` whose `latest` is null when nothing has been consolidated
	 * yet. Writing/consolidating is `consolidatePractice` (B5).
	 */
	getPractice: queryProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
			}),
		)
		.query(({ ctx, input }): PracticeDoc => {
			const projectFilter =
				input.scope === "global"
					? // Global practice has a null projectId by construction.
						eq(memoryPracticeVersions.scope, "global")
					: and(
							eq(memoryPracticeVersions.scope, "project"),
							input.projectId === null
								? eq(memoryPracticeVersions.scope, "project")
								: eq(memoryPracticeVersions.projectId, input.projectId),
						);
			const latest = ctx.db
				.select()
				.from(memoryPracticeVersions)
				.where(projectFilter)
				.orderBy(desc(memoryPracticeVersions.version))
				.get();
			return {
				scope: input.scope,
				projectId: input.scope === "global" ? null : input.projectId,
				latest: latest ? toPracticeVersion(latest) : null,
			};
		}),

	// --- Telemetry (REAL read + record) ------------------------------------

	/**
	 * Token-savings / exploration telemetry. `record` appends a sample;
	 * `read` returns recent samples (optionally project-scoped). B4 surfaces a
	 * "memory saved ~X%" stat from these.
	 */
	telemetry: router({
		record: protectedProcedure
			.input(
				z.object({
					projectId: z.string().nullable().default(null),
					taskId: z.string().nullable().default(null),
					metric: z.string().min(1),
					baselineValue: z.number().int().nullable().default(null),
					observedValue: z.number().int(),
				}),
			)
			.mutation(({ ctx, input }): { id: string } => {
				const id = randomUUID();
				ctx.db
					.insert(memoryTelemetry)
					.values({
						id,
						projectId: input.projectId,
						taskId: input.taskId,
						metric: input.metric,
						baselineValue: input.baselineValue,
						observedValue: input.observedValue,
					})
					.run();
				return { id };
			}),

		read: queryProcedure
			.input(
				z
					.object({
						projectId: z.string().nullable().optional(),
						limit: z.number().int().min(1).max(500).default(100),
					})
					.optional(),
			)
			.query(({ ctx, input }) => {
				const where =
					input?.projectId !== undefined && input.projectId !== null
						? eq(memoryTelemetry.projectId, input.projectId)
						: undefined;
				return ctx.db
					.select()
					.from(memoryTelemetry)
					.where(where)
					.orderBy(desc(memoryTelemetry.createdAt))
					.limit(input?.limit ?? 100)
					.all();
			}),
	}),

	// --- Consolidation (B5): propose / accept / revert ---------------------

	/**
	 * B5 — PROPOSE a consolidated Practice doc for review. Reads CONFIRMED
	 * playbooks (project scope = this project; global scope = cross-project, only
	 * patterns recurring across repos), distills them with the LOCAL/deterministic
	 * heuristic (merge/dedupe/prune — NO model, NO network), and returns the
	 * current doc + proposed doc + a line diff for the UI. Writes NOTHING.
	 */
	consolidatePractice: protectedProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
			}),
		)
		.mutation(({ ctx, input }): ConsolidationProposal => {
			return ctx.runtime.memoryConsolidation.propose({
				scope: input.scope,
				projectId: input.projectId,
			});
		}),

	/**
	 * B5 — ACCEPT a (possibly user-edited) Practice doc: write it to the target
	 * (project = managed block in the repo's `AGENTS.md`; global =
	 * `~/.superset/practice.md`) and record a new `memory_practice_versions` row.
	 * The managed-block write never clobbers hand-written content.
	 */
	acceptPractice: protectedProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
				content: z.string(),
				provenance: z.string().nullable().default(null),
			}),
		)
		.mutation(({ ctx, input }): PracticeVersion => {
			return ctx.runtime.memoryConsolidation.accept({
				scope: input.scope,
				projectId: input.projectId,
				content: input.content,
				provenance: input.provenance,
			});
		}),

	/**
	 * B5 — REVERT to a prior (or specified) Practice version: restore its content
	 * to the target file and record the restore as a NEW version (linear,
	 * auditable history). Defaults to the version before the latest.
	 */
	revertPractice: protectedProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
				toVersion: z.number().int().min(1).optional(),
			}),
		)
		.mutation(({ ctx, input }): PracticeVersion => {
			return ctx.runtime.memoryConsolidation.revert({
				scope: input.scope,
				projectId: input.projectId,
				toVersion: input.toVersion,
			});
		}),

	/** List Practice version history for a scope (newest first) — review/revert. */
	listPracticeVersions: queryProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
			}),
		)
		.query(({ ctx, input }): PracticeVersion[] => {
			return ctx.runtime.memoryConsolidation.listVersions({
				scope: input.scope,
				projectId: input.projectId,
			});
		}),

	// --- Graph + vault (B6) ------------------------------------------------

	/**
	 * B6 — the knowledge-graph data for the in-panel view: `{ nodes, edges }`
	 * where nodes are playbooks / files / area tags / practice docs and edges are
	 * the relationships (playbook→file touched, playbook→area, playbook↔similar,
	 * playbook→practice). Pure assembly from the local rows; no I/O, no network.
	 */
	graph: queryProcedure
		.input(
			z.object({ projectId: z.string().nullable().default(null) }).optional(),
		)
		.query(({ ctx, input }): MemoryGraph => {
			return ctx.runtime.memoryVault.graph({
				projectId: input?.projectId ?? null,
			});
		}),

	/**
	 * B6 — (re)generate the on-disk Obsidian vault under
	 * `~/.superset/memory/vault/` (one note per playbook, with `[[wikilinks]]`).
	 * Idempotent + regenerable; prunes notes for playbooks that no longer exist.
	 */
	regenerateVault: protectedProcedure
		.input(
			z.object({ projectId: z.string().nullable().default(null) }).optional(),
		)
		.mutation(({ ctx, input }): RegenerateVaultResult => {
			return ctx.runtime.memoryVault.regenerateVault({
				projectId: input?.projectId ?? null,
			});
		}),

	// --- Project index (B3) + retrieval (B4), all REAL --------------------

	/**
	 * B3 — report the project index's build/freshness status: whether it's
	 * indexed, entry count, last-indexed time, and the HEAD SHA on the newest
	 * entries. B4 retrieval reads this to decide whether to (re)build first.
	 */
	indexStatus: queryProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(({ ctx, input }): ProjectIndexStatus => {
			return ctx.runtime.memoryIndex.indexStatus(input.projectId);
		}),

	/**
	 * B3 — (re)build the lightweight project index for a project (structural map
	 * + fingerprints). Idempotent; evicts entries for files that no longer exist.
	 * Returns the resulting status.
	 */
	reindex: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.mutation(async ({ ctx, input }): Promise<ProjectIndexStatus> => {
			await ctx.runtime.memoryIndex.buildProjectIndex(input.projectId);
			return ctx.runtime.memoryIndex.indexStatus(input.projectId);
		}),

	/**
	 * B3 — list the indexed entries for a project ("index slices" B4 retrieval
	 * consumes). Each carries path, area tags, an exported-symbol summary, and a
	 * fingerprint id.
	 */
	listIndexEntries: queryProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(({ ctx, input }): ProjectIndexEntry[] => {
			return ctx.runtime.memoryIndex.listEntries(input.projectId);
		}),

	/**
	 * B4 — assemble the high-signal memory bundle for the current intent:
	 * project+global Coding Practice, top-k area-filtered Playbooks, and
	 * Project-Index slices, capped to a token budget (lowest-ranked trimmed
	 * first). Records a `retrieval_tokens` telemetry sample. This is the same
	 * bundle the local memory MCP server returns over `memory.search`.
	 */
	retrieve: queryProcedure
		.input(
			z.object({
				projectId: z.string().nullable().default(null),
				intent: z.string().default(""),
				areaTags: z.array(areaTagSchema).default([]),
				topKPlaybooks: z.number().int().min(1).max(50).default(5),
				topKIndexSlices: z.number().int().min(1).max(50).default(10),
				maxTokens: z.number().int().min(100).max(20000).default(2000),
				includeProvisional: z.boolean().default(false),
			}),
		)
		.query(({ ctx, input }): RetrieveResult => {
			return ctx.runtime.memoryRetrieve.retrieve({
				projectId: input.projectId,
				intent: input.intent,
				areaTags: input.areaTags,
				topKPlaybooks: input.topKPlaybooks,
				topKIndexSlices: input.topKIndexSlices,
				maxTokens: input.maxTokens,
				includeProvisional: input.includeProvisional,
			});
		}),

	/**
	 * B4 — the "memory saved ~X%" stat the Memory panel surfaces, computed from
	 * recorded telemetry samples (per metric: tokens, exploration_steps, …).
	 */
	savedStats: queryProcedure
		.input(
			z.object({
				projectId: z.string().nullable().default(null),
				limit: z.number().int().min(1).max(2000).default(500),
			}),
		)
		.query(({ ctx, input }): SavedStat[] => {
			return ctx.runtime.memoryRetrieve.savedStats({
				projectId: input.projectId,
				limit: input.limit,
			});
		}),
});
