import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSupervisor, waitForDaemonReady } from "../../../daemon";
import { terminalSessions, workspaces } from "../../../db/schema";
import { prepareAgentRootSerialized } from "../../../runtime/workspace-groups";
import {
	countTerminalSessions,
	createTerminalSessionInternal,
	disposeSessionAndWait,
	listTerminalSessions,
	parseThemeType,
	type TerminalRootTarget,
	writeInputToSession,
} from "../../../terminal/terminal";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

/**
 * Terminal create addressing. Additive over the original `{ workspaceId }`:
 *  - `{ workspaceId }` — a single workspace's worktree (unchanged).
 *  - `{ rootTarget: { groupId, rootId } }` — a specific root of a multi-root
 *    workspace ("group"), including a `kind: "folder"` root with no workspace.
 *    Pass `agentRoot: true` to launch the combined agent root (the group's
 *    synthetic parent dir) and have the PTY also export `SUPERSET_ROOTS`.
 *
 * Exactly one of `workspaceId` / `rootTarget` must be provided.
 */
const rootTargetSchema = z.object({
	groupId: z.string(),
	/**
	 * A specific root within the group. Omit together with `agentRoot: true` to
	 * target the combined agent root instead of one root.
	 */
	rootId: z.string().optional(),
	/**
	 * When true, target the group's combined agent root (must have been prepared
	 * via `workspaceGroup.prepareAgentRoot`) and export every root path as
	 * `SUPERSET_ROOTS`.
	 */
	agentRoot: z.boolean().optional(),
});

// Plain object base so `launchSession` can `.extend()` before refinements are
// applied (zod forbids `.extend()` on a refined schema). Both procedures apply
// the same addressing refinements via `withSessionAddressingRefinements`.
const createSessionBaseSchema = z.object({
	workspaceId: z.string().optional(),
	rootTarget: rootTargetSchema.optional(),
	terminalId: z.string().optional(),
	initialCommand: z.string().trim().min(1).optional(),
	cwd: z.string().optional(),
	themeType: z.string().optional(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
});

interface SessionAddressingShape {
	workspaceId?: string;
	rootTarget?: z.infer<typeof rootTargetSchema>;
}

function withSessionAddressingRefinements<
	T extends z.ZodType<SessionAddressingShape>,
>(schema: T) {
	return schema
		.refine(
			(v) => !!v.workspaceId !== !!v.rootTarget,
			"Provide exactly one of workspaceId or rootTarget",
		)
		.refine(
			(v) => !v.rootTarget || !!v.rootTarget.rootId || !!v.rootTarget.agentRoot,
			"rootTarget requires either a rootId or agentRoot: true",
		);
}

const createSessionInputSchema = withSessionAddressingRefinements(
	createSessionBaseSchema,
);

type CreateSessionInput = z.infer<typeof createSessionBaseSchema>;

/**
 * Resolve a `{ groupId, rootId | agentRoot }` addressing into the host-side
 * `TerminalRootTarget` (an absolute rootPath, plus every root path for
 * SUPERSET_ROOTS when launching the combined agent root).
 */
async function resolveRootTarget(
	ctx: HostServiceContext,
	input: z.infer<typeof rootTargetSchema>,
): Promise<TerminalRootTarget> {
	const group = ctx.workspaceGroupStore.get(input.groupId);
	if (!group) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Workspace group not found: ${input.groupId}`,
		});
	}
	const resolved = ctx.workspaceGroupResolver.resolveGroup(group);
	const groupRootPaths = resolved.roots
		.filter((root) => root.exists && root.rootPath !== "")
		.map((root) => root.rootPath);

	if (input.agentRoot) {
		// Serialized per group: createSession and the launcher both prepare the
		// same agent root, so concurrent reconciliations must not interleave.
		const { agentRootPath } = await prepareAgentRootSerialized({
			groupId: group.id,
			roots: resolved.roots,
		});
		return { rootPath: agentRootPath, groupRootPaths };
	}

	const root = resolved.roots.find((r) => r.rootId === input.rootId);
	if (!root) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Root ${input.rootId} not found in group ${input.groupId}`,
		});
	}
	if (!root.exists || root.rootPath === "") {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Root ${input.rootId} of group ${input.groupId} does not resolve to an existing path`,
		});
	}
	return { rootPath: root.rootPath };
}

async function createTerminalSessionFromInput({
	ctx,
	input,
}: {
	ctx: HostServiceContext;
	input: CreateSessionInput;
}) {
	const terminalId = input.terminalId ?? crypto.randomUUID();
	const rootTarget = input.rootTarget
		? await resolveRootTarget(ctx, input.rootTarget)
		: undefined;
	const result = await createTerminalSessionInternal({
		terminalId,
		workspaceId: input.workspaceId,
		rootTarget,
		themeType: parseThemeType(input.themeType),
		db: ctx.db,
		eventBus: ctx.eventBus,
		initialCommand: input.initialCommand,
		cwd: input.cwd,
		cols: input.cols,
		rows: input.rows,
	});

	if ("error" in result) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: result.error,
		});
	}

	return {
		terminalId: result.terminalId,
		status: "active" as const,
	};
}

// Daemon control surface — sibling to the per-workspace terminal ops above.
// Org-scoped (one daemon per host-service); org id comes from request ctx
// rather than env so this module can be imported in tests where env vars
// aren't set.
// Supervisor lives in this same process so calls go through the in-process
// singleton, not over the wire.
const daemonRouter = router({
	getUpdateStatus: protectedProcedure.query(({ ctx }) =>
		getSupervisor().getUpdateStatus(ctx.organizationId),
	),

	listSessions: protectedProcedure.query(async ({ ctx }) => {
		// Wait for the bootstrap so the supervisor has a socket path.
		await waitForDaemonReady(ctx.organizationId);
		return getSupervisor().listSessions(ctx.organizationId);
	}),

	restart: protectedProcedure.mutation(async ({ ctx }) => {
		await waitForDaemonReady(ctx.organizationId);
		return getSupervisor().restart(ctx.organizationId);
	}),

	/**
	 * Phase 2: hand off live PTYs to a successor daemon binary.
	 *
	 * Sessions survive on success — the kernel master fds are inherited by
	 * the new daemon process via stdio. The renderer surfaces this as the
	 * "Update" path (vs `restart` which kills sessions). On failure, the
	 * UI offers force-restart as a fallback.
	 */
	update: protectedProcedure.mutation(async ({ ctx }) => {
		await waitForDaemonReady(ctx.organizationId);
		return getSupervisor().update(ctx.organizationId);
	}),
});

export const terminalRouter = router({
	createSession: protectedProcedure
		.input(createSessionInputSchema)
		.mutation(createTerminalSessionFromInput),

	launchSession: protectedProcedure
		.input(
			withSessionAddressingRefinements(
				createSessionBaseSchema.extend({
					initialCommand: z.string().trim().min(1),
				}),
			),
		)
		.mutation(createTerminalSessionFromInput),

	listSessions: protectedProcedure
		.input(
			z.object({
				workspaceId: z.string(),
			}),
		)
		.query(({ input }) => ({
			sessions: listTerminalSessions({
				workspaceId: input.workspaceId,
				includeExited: false,
			}),
		})),

	countBackgroundSessions: protectedProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				attachedTerminalIds: z.array(z.string()).default([]),
			}),
		)
		.query(({ input }) => ({
			count: countTerminalSessions({
				workspaceId: input.workspaceId,
				includeExited: false,
				excludeTerminalIds: input.attachedTerminalIds,
			}),
		})),

	writeInput: protectedProcedure
		.input(
			z.object({
				terminalId: z.string(),
				workspaceId: z.string(),
				data: z.string(),
			}),
		)
		.mutation(({ input }) => {
			const result = writeInputToSession(input);
			if ("error" in result) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: result.error,
				});
			}
			return { success: true as const };
		}),

	killSession: protectedProcedure
		.input(
			z.object({
				terminalId: z.string(),
				workspaceId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const workspace = ctx.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, input.workspaceId) })
				.sync();

			if (!workspace) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Workspace not found",
				});
			}

			const session = ctx.db.query.terminalSessions
				.findFirst({ where: eq(terminalSessions.id, input.terminalId) })
				.sync();

			if (!session) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Terminal session not found",
				});
			}

			if (session.originWorkspaceId !== input.workspaceId) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Terminal session does not belong to this workspace",
				});
			}

			await disposeSessionAndWait(input.terminalId, ctx.db);
			ctx.terminalAgentStore.markTerminalExited(input.terminalId);
			return { terminalId: input.terminalId, status: "disposed" as const };
		}),

	daemon: daemonRouter,
});
