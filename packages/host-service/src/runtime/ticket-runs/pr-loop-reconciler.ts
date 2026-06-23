import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { ticketRuns } from "../../db/schema.ts";
import type { ApiClient } from "../../types.ts";

/**
 * B6 — close the ticket→PR loop. When the autonomous run's PR is first detected
 * (the PR-runtime `onPullRequestLinked` hook), match the PR's head branch to a
 * `ticket_runs.branch` (B5 recorded it), stamp the row's `pr_url`, and write the
 * PR url + an in-review status back to the cloud task — which the cloud side
 * pushes to Linear via the existing outbound `syncTask`.
 *
 * Multi-repo: each run row shares the one `taskId`, so every repo's PR writes
 * its url back to the SAME ticket (each call links one more PR to the ticket).
 *
 * Idempotent + best-effort (mirrors the B2 memory pr-capture reconciler): a PR
 * with no matching `ticket_runs` row is a no-op; an already-stamped row is not
 * re-written; and any writeback error is swallowed + warned so PR sync never
 * fails on loop closure.
 */

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
 */
export async function reconcileTicketRunForPr(options: {
	db: HostDb;
	writeback: TicketTaskWriteback;
	projectId: string;
	headBranch: string;
	prUrl: string;
	now?: () => number;
}): Promise<ReconcileTicketRunResult> {
	const { db, writeback, projectId, headBranch, prUrl } = options;
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

		// Write the PR url + in-review status back to the cloud task (→ Linear).
		try {
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
			await writeback.updateTask({ id: taskId, prUrl, statusId });
			result.taskWriteback = "ok";
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
