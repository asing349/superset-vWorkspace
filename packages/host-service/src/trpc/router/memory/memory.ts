import { randomUUID } from "node:crypto";
import {
	type AreaTag,
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
} from "@superset/memory";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	memoryTelemetry,
} from "../../../db/schema";
import {
	ensureMemoryRootDir,
	type ProjectIndexStatus,
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

// ---------------------------------------------------------------------------
// Typed stub shapes — milestones B3/B4/B5. These return a typed
// "not-implemented-here" result so callers/typecheck never break; each is
// tagged with its owning milestone. Do NOT throw from a stub.
// ---------------------------------------------------------------------------

interface NotImplemented {
	implemented: false;
	/** The milestone that will implement this. */
	milestone: string;
}

const notImplemented = (milestone: string): NotImplemented => ({
	implemented: false,
	milestone,
});

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
		.mutation(({ ctx, input }): Playbook => {
			// Establish the on-disk memory root the first time we capture; the
			// vault/index writers (B3/B6) live there.
			ensureMemoryRootDir();

			const intent = redactText(input.intent).text;
			const touchedPaths = redactAll(input.touchedPaths);
			const commands = redactAll(input.commands);
			const gotcha =
				input.gotcha === null ? null : redactText(input.gotcha).text;
			const diffShape =
				input.diffShape === null ? null : redactText(input.diffShape).text;
			const validation =
				input.validation === null ? null : redactText(input.validation).text;

			// Derive areas from the (redacted) paths; merge any explicit labels B2
			// passed. Paths are repo-relative so redaction rarely changes them, but
			// we derive from the post-redaction list to stay consistent with what we
			// persist.
			const derived = pathsToAreas(touchedPaths);
			const areaTags = input.areaTags
				? [...new Set([...input.areaTags, ...derived])]
				: derived;

			const id = randomUUID();
			ctx.db
				.insert(memoryPlaybooks)
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
			return readBackPlaybook(ctx.db, id);
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

	// --- Stubs for later milestones (typed, never throw) -------------------

	/** STUB — B5 (consolidation): propose a reviewed diff to a Practice doc. */
	consolidatePractice: protectedProcedure
		.input(
			z.object({
				scope: practiceScopeSchema,
				projectId: z.string().nullable().default(null),
			}),
		)
		.mutation((): NotImplemented => notImplemented("B5")),

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

	/** STUB — B4 (retrieval): assemble the memory bundle for an intent. */
	retrieve: queryProcedure
		.input(
			z.object({
				projectId: z.string().nullable().default(null),
				intent: z.string().default(""),
				areaTags: z.array(areaTagSchema).default([]),
				topK: z.number().int().min(1).max(50).default(5),
			}),
		)
		.query((): NotImplemented & { playbooks: Playbook[] } => ({
			...notImplemented("B4"),
			playbooks: [],
		})),
});
