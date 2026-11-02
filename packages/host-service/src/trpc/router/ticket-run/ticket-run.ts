import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { readTicketPlanSnapshot } from "../../../runtime/ticket-plans/snapshot";
import { ticketPlanScopeSchema } from "../../../runtime/ticket-plans/types";
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
	planId: z.string().uuid().optional(),
	executorAgent: z.enum(["claude", "codex"]).default("claude"),
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
 * code is written here. `taskId` is the cloud task UUID and is ABSENT for a
 * local-sourced run (no cloud `tasks` row to link to); `ticketKey` lives in the
 * prompt only.
 */
function makeCreateWorkspace(
	ctx: HostServiceContext,
	executorAgent: "claude" | "codex",
): CreateWorkspaceFn {
	const caller = workspacesRouter.createCaller(ctx);
	return async (args): Promise<CreatedWorkspace> => {
		const result = await caller.create({
			projectId: args.projectId,
			baseBranch: args.baseBranch,
			taskId: args.taskId,
			agents: [{ agent: executorAgent, prompt: args.prompt }],
		});
		return {
			workspaceId: result.workspace.id,
			branch: result.workspace.branch ?? null,
		};
	};
}

export function createTicketRunRouter(
	options: {
		readSnapshot?: typeof readTicketPlanSnapshot;
		createWorkspace?: typeof makeCreateWorkspace;
	} = {},
) {
	return router({
		/**
		 * Start an autonomous ticket→PR run. Requires approved context and a one-use independently reviewed plan; on
		 * none, throws PRECONDITION_FAILED. Fans out one run row per repo; a per-repo
		 * failure is recorded on its row, not thrown globally. Stops at PR creation.
		 */
		start: protectedProcedure
			.input(startInputSchema)
			.mutation(async ({ ctx, input }): Promise<DispatchTicketRunResult> => {
				try {
					if (!input.planId)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message:
								"Prepare a plan and obtain independent agent approval before execution.",
						});
					const scope = ticketPlanScopeSchema.parse(input);
					const snapshot = await (
						options.readSnapshot ?? readTicketPlanSnapshot
					)(ctx.db, scope);
					let implementationPlan: string;
					try {
						implementationPlan = ctx.runtime.ticketPlans.consume(
							input.planId,
							scope,
							snapshot,
						);
					} catch (error) {
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message:
								error instanceof Error
									? error.message
									: "Plan approval could not be verified",
						});
					}
					return await dispatchTicketRun({
						db: ctx.db,
						retrieve: ctx.runtime.memoryRetrieve,
						input: { ...input, implementationPlan },
						createWorkspace: (options.createWorkspace ?? makeCreateWorkspace)(
							ctx,
							input.executorAgent,
						),
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
}

export const ticketRunRouter = createTicketRunRouter();
