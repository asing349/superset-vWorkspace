/**
 * The fixed host contract for launching the autonomous ticket -> PR run (B5).
 * Host builds `ticketRun.start` against THIS exact shape; the renderer assembles
 * the args and invokes it. Keep in lockstep with the host contract — do not let
 * this diverge.
 */
export interface TicketRunRepo {
	projectId: string;
	/** Optional base branch; when omitted the host derives the repo's default. */
	baseBranch?: string;
}

export interface TicketRunRequest {
	/** Cloud task id (Linear-synced `tasks.id`). */
	taskId: string;
	/** Human ticket key, e.g. "SUPER-172" (slug fallback). */
	ticketKey: string;
	/** Repos to run, PRIMARY FIRST. One per repo -> one worktree + one PR. */
	repos: TicketRunRepo[];
	/**
	 * The project the developer-approved context is keyed under
	 * `(projectId, taskId)` — always the PRIMARY repo's projectId.
	 */
	approvedContextProjectId: string;
}

interface BuildTicketRunRequestParams {
	taskId: string;
	ticketKey: string;
	/** The primary (default) repo's host project id. */
	primaryProjectId: string;
	/** Additional repo project ids selected for a multi-repo run (may be empty). */
	additionalProjectIds: string[];
}

/**
 * Assemble the `ticketRun.start` request from the selected repos.
 *
 * - The primary repo is always first in `repos`.
 * - `approvedContextProjectId` is always the primary repo's projectId.
 * - Duplicate project ids are de-duped; the primary is never repeated in the
 *   additional set.
 */
export function buildTicketRunRequest({
	taskId,
	ticketKey,
	primaryProjectId,
	additionalProjectIds,
}: BuildTicketRunRequestParams): TicketRunRequest {
	const seen = new Set<string>([primaryProjectId]);
	const repos: TicketRunRepo[] = [{ projectId: primaryProjectId }];
	for (const projectId of additionalProjectIds) {
		if (seen.has(projectId)) continue;
		seen.add(projectId);
		repos.push({ projectId });
	}
	return {
		taskId,
		ticketKey,
		repos,
		approvedContextProjectId: primaryProjectId,
	};
}

/**
 * The one-confirm message for a multi-repo run:
 * "Changes needed in X, Y, Z — proceed?".
 */
export function multiRepoConfirmMessage(projectNames: string[]): string {
	return `Changes needed in ${projectNames.join(", ")} — proceed?`;
}
