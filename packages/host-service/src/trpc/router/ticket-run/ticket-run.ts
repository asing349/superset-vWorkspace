import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	type CreatedWorkspace,
	type CreateWorkspaceFn,
	type DispatchTicketRunResult,
	dispatchTicketRun,
	TicketContextNotApprovedError,
} from "../../../runtime/ticket-runs";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";
import { workspacesRouter } from "../workspaces";

/**
 * `ticketRun` router (Wave 4, Part B — B5). The host-side ticket→PR orchestrator
 * entrypoint. Autonomous to PR CREATION ONLY — the assembled prompt forbids
 * merging and this router never invokes a merge tool.
 *
 * Contract (called by tickets' B4):
 *   ticketRun.start({ taskId, ticketKey, repos: [{ projectId, baseBranch? }],
 *                     approvedContextProjectId })
 */

const startInputSchema = z.object({
	/**
	 * The approved-context key. Cloud ticket → cloud `tasks.id` (Linear-synced);
	 * local ticket → the source-tagged `unifiedId` it was keyed under.
	 */
	taskId: z.string().min(1),
	/**
	 * W7-M4: the source-tagged `unifiedId` (`${source}:${sourceId}`) from the
	 * source-agnostic ticket layer, so the run→PR writeback routes to the active
	 * source (cloud `task.update` / direct Linear). Omitted by legacy cloud callers
	 * → the bare `taskId` is treated as cloud (unchanged).
	 */
	unifiedId: z.string().min(1).optional(),
	/** Ticket key (e.g. "SUPER-172"), carried into branch/PR for B6 linking. */
	ticketKey: z.string().min(1),
	/** One entry per repo the run touches (single by default; N if multi-repo). */
	repos: z
		.array(
			z.object({
				projectId: z.string().min(1),
				baseBranch: z.string().min(1).optional(),
			}),
		)
		.min(1),
	/** The projectId the approved context was stored under (B3 store key). */
	approvedContextProjectId: z.string().min(1),
});

/**
 * Wrap the host `workspaces.create` new-branch-from-base path as the injected
 * worktree+agent launcher. Reuses the existing create procedure wholesale (the
 * worktree + `agents:[{ agent:"claude", prompt }]` launch), so NO new git/clone
 * code is written here. `taskId` is the cloud task UUID; `ticketKey` lives in
 * the prompt only.
 */
function makeCreateWorkspace(ctx: HostServiceContext): CreateWorkspaceFn {
	const caller = workspacesRouter.createCaller(ctx);
	return async (args): Promise<CreatedWorkspace> => {
		const result = await caller.create({
			projectId: args.projectId,
			baseBranch: args.baseBranch,
			taskId: args.taskId,
			agents: [{ agent: "claude", prompt: args.prompt }],
		});
		return {
			workspaceId: result.workspace.id,
			branch: result.workspace.branch ?? null,
		};
	};
}

export const ticketRunRouter = router({
	/**
	 * Start an autonomous ticket→PR run. Requires an approved context (B3); on
	 * none, throws PRECONDITION_FAILED. Fans out one run row per repo; a per-repo
	 * failure is recorded on its row, not thrown globally. Stops at PR creation.
	 */
	start: protectedProcedure
		.input(startInputSchema)
		.mutation(async ({ ctx, input }): Promise<DispatchTicketRunResult> => {
			try {
				return await dispatchTicketRun({
					db: ctx.db,
					retrieve: ctx.runtime.memoryRetrieve,
					input,
					createWorkspace: makeCreateWorkspace(ctx),
				});
			} catch (err) {
				if (err instanceof TicketContextNotApprovedError) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: err.message,
					});
				}
				throw err;
			}
		}),
});
