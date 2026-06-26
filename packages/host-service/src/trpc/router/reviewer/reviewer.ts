import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { projects } from "../../../db/schema";
import {
	buildGroundingServices,
	buildReviewerContextSnapshot,
	computeBusinessRulesSignature,
	DEFAULT_REVIEWER_GROUNDING_LAYERS,
	diffReviewerContext,
	getAcceptedObservedRules,
	getReviewerConfigRow,
	type ReviewerConfigRow,
	type ReviewerContextDiff,
	type ReviewerContextInputs,
	snapshotFromRow,
	upsertReviewerConfig,
} from "../../../runtime/pr-review/index";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, queryProcedure, router } from "../../index";

/**
 * `reviewer` router (Wave 6, M5). The host-side, per-project onboarding/config
 * for the AI PR reviewer — mirrors the wave-4 `ticketContext` per-project config
 * precedent (upsert-keyed `(projectId)`, host-local, cloud schema frozen).
 *
 * The reviewer grounds on the wave-3 LOCAL memory (Coding Practice + Project
 * Index + Playbooks). "Set up AI reviewer" snapshots a FINGERPRINT of that
 * context; "Refresh context" diffs the current context against the snapshot and
 * re-baselines on an explicit click — it NEVER auto-runs (the app.ts listeners
 * only flip a `stale` flag). No new Superset cloud model call; nothing here is
 * free model text, so there is nothing to redact (Assumption A3/A5).
 */

/** The per-project config surfaced to the renderer (derived from the row). */
export interface ReviewerConfig {
	projectId: string;
	enabled: boolean;
	groundingLayers: string[];
	practiceProjectVersion: number | null;
	practiceGlobalVersion: number | null;
	indexCommitSha: string | null;
	indexLastIndexedAt: number | null;
	indexEntryCount: number;
	stale: boolean;
	configuredBy: string | null;
	configuredAt: number;
}

/** Per-project context status for the (single + cross-project) manage views. */
export interface ReviewerContextStatus {
	projectId: string;
	/** Friendly repo path for the manage-view card label (host-side). */
	repoPath: string | null;
	/** True once "Set up AI reviewer" has run and is enabled. */
	configured: boolean;
	/** The flag-only staleness set by the app.ts listeners. */
	stale: boolean;
	/** The authoritative on-demand diff of current context vs the snapshot. */
	diff: ReviewerContextDiff;
	config: ReviewerConfig | null;
}

const projectIdInput = z.object({ projectId: z.string().min(1) });

function requireProject(
	ctx: HostServiceContext,
	projectId: string,
): { id: string; repoPath: string } {
	const row = ctx.db
		.select({ id: projects.id, repoPath: projects.repoPath })
		.from(projects)
		.where(eq(projects.id, projectId))
		.get();
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Project not set up locally: ${projectId}`,
		});
	}
	return { id: row.id, repoPath: row.repoPath };
}

function toReviewerConfig(row: ReviewerConfigRow): ReviewerConfig {
	const snapshot = snapshotFromRow(row);
	return {
		projectId: row.projectId,
		enabled: row.enabled,
		groundingLayers: snapshot.groundingLayers,
		practiceProjectVersion: row.practiceProjectVersion,
		practiceGlobalVersion: row.practiceGlobalVersion,
		indexCommitSha: row.indexCommitSha,
		indexLastIndexedAt: row.indexLastIndexedAt,
		indexEntryCount: row.indexEntryCount,
		stale: row.stale,
		configuredBy: row.configuredBy,
		configuredAt: row.updatedAt,
	};
}

/**
 * Gather the CURRENT context inputs for a project — the practice versions (read
 * via the same `buildGroundingServices` the reviewer grounds on) + the full
 * project-index status (`commitSha` / `lastIndexedAt` / entry count). This is
 * the value snapshotted at setup/refresh and diffed against the stored snapshot.
 */
function gatherReviewerContextInputs(options: {
	ctx: HostServiceContext;
	projectId: string;
	groundingLayers: string[];
}): ReviewerContextInputs {
	const { ctx, projectId, groundingLayers } = options;
	const grounding = buildGroundingServices({
		db: ctx.db,
		memoryRetrieve: ctx.runtime.memoryRetrieve,
		memoryIndex: ctx.runtime.memoryIndex,
		readPracticeVersion: (practiceInput) =>
			ctx.runtime.memoryRetrieve.readPracticeVersion(practiceInput),
	});

	const projectPractice = grounding.practice.getPractice({
		scope: "project",
		projectId,
	}).latest;
	const globalPractice = grounding.practice.getPractice({
		scope: "global",
		projectId: null,
	}).latest;
	// The grounding adapter's `indexStatus` narrows to `{ indexed, entryCount }`;
	// the full status (commit sha + last-indexed) comes from the index runtime.
	const indexStatus = ctx.runtime.memoryIndex.indexStatus(projectId);
	// Wave-6 M6: fold the ACCEPTED observed business rules' signature into the
	// snapshot so accepting/reverting a rule moves the context hash (→ "Refresh
	// context" detects an observed-business-rules change).
	const acceptedRules = getAcceptedObservedRules({ db: ctx.db, projectId });

	return {
		groundingLayers,
		practiceProjectVersionId: projectPractice?.id ?? null,
		practiceProjectVersion: projectPractice?.version ?? null,
		practiceGlobalVersionId: globalPractice?.id ?? null,
		practiceGlobalVersion: globalPractice?.version ?? null,
		indexCommitSha: indexStatus.commitSha,
		indexLastIndexedAt: indexStatus.lastIndexedAt,
		indexEntryCount: indexStatus.entryCount,
		businessRulesSignature: computeBusinessRulesSignature(acceptedRules),
	};
}

/** Compute a project's context status (config + flag-only stale + live diff). */
function computeContextStatus(options: {
	ctx: HostServiceContext;
	projectId: string;
	repoPath: string | null;
}): ReviewerContextStatus {
	const { ctx, projectId, repoPath } = options;
	const row = getReviewerConfigRow({ db: ctx.db, projectId });
	if (!row) {
		return {
			projectId,
			repoPath,
			configured: false,
			stale: false,
			diff: { changed: false, changes: [] },
			config: null,
		};
	}

	const snapshot = snapshotFromRow(row);
	const current = gatherReviewerContextInputs({
		ctx,
		projectId,
		groundingLayers: snapshot.groundingLayers,
	});
	const diff = diffReviewerContext({ snapshot, current });

	return {
		projectId,
		repoPath,
		configured: row.enabled,
		stale: row.stale,
		diff,
		config: toReviewerConfig(row),
	};
}

export const reviewerRouter = router({
	/**
	 * Read the reviewer config for a project, or `null` when "Set up AI reviewer"
	 * has not run yet. The renderer reads this on open/view; it onboards NOTHING.
	 */
	getConfig: queryProcedure
		.input(projectIdInput)
		.query(({ ctx, input }): ReviewerConfig | null => {
			const row = getReviewerConfigRow({
				db: ctx.db,
				projectId: input.projectId,
			});
			return row ? toReviewerConfig(row) : null;
		}),

	/**
	 * Whether to show the "Set up AI reviewer" setup card (gated like
	 * `config.shouldShowSetupCard`): true while the reviewer is not yet
	 * configured/enabled for this project.
	 */
	shouldShowSetupCard: queryProcedure
		.input(projectIdInput)
		.query(({ ctx, input }): boolean => {
			const row = getReviewerConfigRow({
				db: ctx.db,
				projectId: input.projectId,
			});
			return !row || !row.enabled;
		}),

	/**
	 * The per-project context status (config + flag-only stale + the authoritative
	 * on-demand diff of current context vs the snapshot). Drives the single-project
	 * "Refresh context" affordance; reads only — it refreshes NOTHING.
	 */
	getContextStatus: queryProcedure
		.input(projectIdInput)
		.query(({ ctx, input }): ReviewerContextStatus => {
			const project = requireProject(ctx, input.projectId);
			return computeContextStatus({
				ctx,
				projectId: project.id,
				repoPath: project.repoPath,
			});
		}),

	/**
	 * Per-project context status for EVERY local project — the cross-project
	 * "Manage context" view's data source. Enumerates `projects` (same as
	 * `project.list`) and computes each project's status. Reads only.
	 */
	listContextStatus: queryProcedure.query(
		({ ctx }): ReviewerContextStatus[] => {
			const rows = ctx.db
				.select({ id: projects.id, repoPath: projects.repoPath })
				.from(projects)
				.all();
			return rows.map((row) =>
				computeContextStatus({
					ctx,
					projectId: row.id,
					repoPath: row.repoPath,
				}),
			);
		},
	),

	/**
	 * "Set up AI reviewer" — onboard the reviewer for a project: snapshot the
	 * CURRENT context (grounded via `buildGroundingServices`) and mark it ready
	 * (`enabled`). Re-running re-baselines the snapshot (upsert keyed `(projectId)`,
	 * resets `stale=false`). The ONLY trigger is an explicit user click.
	 */
	setup: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				groundingLayers: z.array(z.string().min(1)).optional(),
				configuredBy: z.string().nullable().default(null),
			}),
		)
		.mutation(({ ctx, input }): ReviewerConfig => {
			const project = requireProject(ctx, input.projectId);
			const groundingLayers =
				input.groundingLayers && input.groundingLayers.length > 0
					? input.groundingLayers
					: [...DEFAULT_REVIEWER_GROUNDING_LAYERS];

			const inputs = gatherReviewerContextInputs({
				ctx,
				projectId: project.id,
				groundingLayers,
			});
			const snapshot = buildReviewerContextSnapshot(inputs);
			const row = upsertReviewerConfig({
				db: ctx.db,
				projectId: project.id,
				enabled: true,
				snapshot,
				configuredBy: input.configuredBy,
			});
			return toReviewerConfig(row);
		}),

	/**
	 * "Refresh context" — re-read the current context, diff it against the stored
	 * snapshot (via `isFingerprintStale`), and RE-BASELINE the snapshot (clearing
	 * `stale`). Returns WHAT changed so the UI can show it. Optionally rebuilds the
	 * project index first (`reindex`). The ONLY trigger is an explicit user click —
	 * the read-side never refreshes on its own.
	 */
	refreshContext: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				/** Rebuild the project index before snapshotting (heavier). */
				reindex: z.boolean().default(false),
			}),
		)
		.mutation(
			async ({
				ctx,
				input,
			}): Promise<{ diff: ReviewerContextDiff; config: ReviewerConfig }> => {
				const project = requireProject(ctx, input.projectId);
				const existing = getReviewerConfigRow({
					db: ctx.db,
					projectId: project.id,
				});
				if (!existing) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `AI reviewer not set up for project: ${project.id}`,
					});
				}

				if (input.reindex) {
					await ctx.runtime.memoryIndex.buildProjectIndex(project.id);
				}

				const snapshot = snapshotFromRow(existing);
				const current = gatherReviewerContextInputs({
					ctx,
					projectId: project.id,
					groundingLayers: snapshot.groundingLayers,
				});
				const diff = diffReviewerContext({ snapshot, current });

				// Re-baseline to the current context (resets `stale`). This is the
				// explicit refresh — never reached from a read/effect.
				const nextSnapshot = buildReviewerContextSnapshot(current);
				const row = upsertReviewerConfig({
					db: ctx.db,
					projectId: project.id,
					enabled: existing.enabled,
					snapshot: nextSnapshot,
					configuredBy: existing.configuredBy,
				});
				return { diff, config: toReviewerConfig(row) };
			},
		),
});
