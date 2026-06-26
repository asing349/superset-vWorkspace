import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { ticketRuns } from "../../db/schema.ts";
import type { ApiClient } from "../../types.ts";
import {
	parseUnifiedTicketId,
	resolveWritebackTarget,
	type TicketWritebackTarget,
} from "../tickets";
import type { LocalTicketWriteback } from "./linear-writeback.ts";

/**
 * B6 — close the ticket→PR loop. When the autonomous run's PR is first detected
 * (the PR-runtime `onPullRequestLinked` hook), match the PR's head branch to a
 * `ticket_runs.branch` (B5 recorded it), stamp the row's `pr_url`, and write the
 * PR url + an in-review status back to the ACTIVE SOURCE.
 *
 * Wave-7 M4: the run carries a source-tagged id in `ticket_runs.taskId` (the
 * `unifiedId` `${source}:${sourceId}`), so writeback is ROUTED by source:
 *   - cloud → `ctx.api.task.update` (unchanged wave-4 behavior; the cloud side
 *     pushes to Linear via the existing outbound `syncTask`).
 *   - local → a DIRECT Linear update/comment with the M1 host token (no cloud
 *     round-trip).
 * A bare/legacy `taskId` (no `source:` prefix — wave-4 stored the cloud `tasks.id`
 * directly) is treated as CLOUD, so pre-M4 rows + the cloud path are unchanged.
 *
 * Multi-repo: each run row shares the one `taskId`, so every repo's PR writes
 * its url back to the SAME ticket (each call links one more PR to the ticket).
 *
 * Idempotent + best-effort (mirrors the B2 memory pr-capture reconciler): a PR
 * with no matching `ticket_runs` row is a no-op; an already-stamped row is not
 * re-written; and any writeback error is swallowed + warned so PR sync never
 * fails on loop closure.
 */

// Source prefixes a wave-7 `unifiedId` carries. A `ticket_runs.taskId` WITHOUT one
// of these is a legacy/bare cloud task id (wave-4) and routes to the cloud path.
const UNIFIED_SOURCE_PREFIXES = ["cloud:", "local:"] as const;

/**
 * Resolve where a run's writeback must go from its stored `taskId`. Tolerant of
 * legacy/bare cloud task ids (no `source:` prefix → cloud) so pre-M4 rows and the
 * unchanged cloud path keep working; a `${source}:${sourceId}` id is parsed via
 * the M3 unified-id helpers and routed by source.
 */
export function resolveRunWritebackTarget(
	taskId: string,
): TicketWritebackTarget {
	const isUnified = UNIFIED_SOURCE_PREFIXES.some((prefix) =>
		taskId.startsWith(prefix),
	);
	if (!isUnified) return { kind: "cloud", taskId };
	return resolveWritebackTarget(parseUnifiedTicketId(taskId));
}

/** A status as returned by the cloud `task.statuses.list` query. */
export interface TaskStatusOption {
	id: string;
	name: string;
	type: string;
}

/**
 * The cloud writeback surface the reconciler needs — injected so tests fake it
 * (no network). Production wraps the host `ctx.api` (see `createApiTaskWriteback`).
 */
export interface TicketTaskWriteback {
	/** List the org's task statuses (to resolve the in-review status). */
	listStatuses(): Promise<TaskStatusOption[]>;
	/** Update the cloud task (prUrl + optional statusId) → triggers Linear sync. */
	updateTask(input: {
		id: string;
		prUrl: string;
		statusId?: string;
	}): Promise<void>;
}

/**
 * Resolve the status id to move the ticket to "in review". Best-effort and
 * heuristic (there is no fixed "review" status TYPE in the schema — statuses are
 * per-org/per-integration rows): prefer a status whose NAME contains "review",
 * else fall back to the first `started`-type status. Returns null when nothing
 * sensible matches (the caller then writes only the prUrl). Pure + testable.
 */
export function resolveInReviewStatusId(
	statuses: readonly TaskStatusOption[],
): string | null {
	const byReviewName = statuses.find((s) =>
		s.name.toLowerCase().includes("review"),
	);
	if (byReviewName) return byReviewName.id;
	const started = statuses.find((s) => s.type === "started");
	return started?.id ?? null;
}

export interface ReconcileTicketRunResult {
	/** ids of `ticket_runs` rows whose `pr_url` was stamped this call. */
	linked: string[];
	/** Whether the cloud task writeback was attempted + succeeded. */
	taskWriteback: "skipped" | "ok" | "failed";
}

/**
 * Match a detected PR to its ticket run(s) and close the loop. Never throws.
 *
 * Wave-7 M4: writeback is routed by the run's source (see
 * {@link resolveRunWritebackTarget}). The cloud path uses `writeback`
 * (`ctx.api.task.update`, unchanged); a local-sourced run uses `localWriteback`
 * (direct Linear API). `localWriteback` is optional so legacy/cloud-only callers
 * and the existing wave-4 tests are unaffected.
 */
export async function reconcileTicketRunForPr(options: {
	db: HostDb;
	writeback: TicketTaskWriteback;
	/** Direct-Linear writeback for LOCAL-sourced runs (W7-M4). Required only for local. */
	localWriteback?: LocalTicketWriteback;
	projectId: string;
	headBranch: string;
	prUrl: string;
	now?: () => number;
}): Promise<ReconcileTicketRunResult> {
	const { db, writeback, localWriteback, projectId, headBranch, prUrl } =
		options;
	const now = options.now ?? Date.now;
	const result: ReconcileTicketRunResult = {
		linked: [],
		taskWriteback: "skipped",
	};

	try {
		// Match by (projectId, branch). A run row exists only for an autonomous
		// ticket run, so a manually-opened PR with no run row is a clean no-op.
		const rows = db
			.select({
				id: ticketRuns.id,
				taskId: ticketRuns.taskId,
				prUrl: ticketRuns.prUrl,
			})
			.from(ticketRuns)
			.where(
				and(
					eq(ticketRuns.projectId, projectId),
					eq(ticketRuns.branch, headBranch),
				),
			)
			.all();

		if (rows.length === 0) return result;

		let taskId: string | null = null;
		for (const row of rows) {
			taskId = row.taskId;
			// Idempotent: only stamp a row that hasn't been linked yet.
			if (row.prUrl === prUrl) continue;
			db.update(ticketRuns)
				.set({ prUrl, updatedAt: now() })
				.where(eq(ticketRuns.id, row.id))
				.run();
			result.linked.push(row.id);
		}

		if (!taskId) return result;

		// W7-M4: route the PR url + in-review status writeback to the ACTIVE SOURCE.
		const target = resolveRunWritebackTarget(taskId);
		try {
			if (target.kind === "cloud") {
				// Cloud path — unchanged wave-4 behavior (→ Linear via outbound syncTask).
				let statusId: string | undefined;
				try {
					const statuses = await writeback.listStatuses();
					statusId = resolveInReviewStatusId(statuses) ?? undefined;
				} catch (statusErr) {
					// Status resolution is best-effort — still write the prUrl below.
					console.warn(
						"[host-service:ticket-run] failed to resolve in-review status",
						{ projectId, taskId, error: statusErr },
					);
				}
				await writeback.updateTask({ id: target.taskId, prUrl, statusId });
				result.taskWriteback = "ok";
			} else if (localWriteback) {
				// Local path — DIRECT Linear writeback with the M1 host token. No cloud
				// round-trip: a comment with the PR url + best-effort in-review state.
				await localWriteback.writeBack({ issueId: target.issueId, prUrl });
				result.taskWriteback = "ok";
			} else {
				// A local-sourced run with no local writeback wired — skip (never throw).
				console.warn(
					"[host-service:ticket-run] local writeback unavailable; skipping",
					{ projectId, issueId: target.issueId },
				);
			}
		} catch (writebackErr) {
			result.taskWriteback = "failed";
			console.warn(
				"[host-service:ticket-run] task writeback failed (PR url/status)",
				{ projectId, taskId, prUrl, error: writebackErr },
			);
		}
	} catch (error) {
		// Matching/stamping failure must never break PR sync.
		console.warn(
			"[host-service:ticket-run] failed to reconcile ticket run for PR",
			{ projectId, headBranch, error },
		);
	}

	return result;
}

/**
 * Production writeback backed by the host cloud api client (`ctx.api`). The
 * client is org+user scoped already; `task.update` triggers the existing
 * outbound `syncTask` → Linear, so we write nothing Linear-specific here.
 */
export function createApiTaskWriteback(api: ApiClient): TicketTaskWriteback {
	return {
		async listStatuses() {
			return api.task.statuses.list.query();
		},
		async updateTask(input) {
			await api.task.update.mutate({
				id: input.id,
				prUrl: input.prUrl,
				...(input.statusId ? { statusId: input.statusId } : {}),
			});
		},
	};
}
