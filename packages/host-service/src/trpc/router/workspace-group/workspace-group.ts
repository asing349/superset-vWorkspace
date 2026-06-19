import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	WorkspaceGroup,
	WorkspaceGroupRootInput,
} from "../../../runtime/workspace-groups";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, queryProcedure, router } from "../../index";

const rootKindSchema = z.enum(["workspace", "folder"]);

/**
 * A root to add/create, before the store assigns `rootId`/`position`. A
 * `kind: "workspace"` root must carry a `workspaceId` (and null `folderPath`);
 * a `kind: "folder"` root must carry a `folderPath` (and null `workspaceId`).
 */
const rootInputSchema = z
	.object({
		kind: rootKindSchema,
		workspaceId: z.string().nullable(),
		folderPath: z.string().nullable(),
		label: z.string(),
	})
	.refine(
		(root) =>
			root.kind === "workspace"
				? root.workspaceId !== null && root.folderPath === null
				: root.folderPath !== null && root.workspaceId === null,
		{
			message:
				'kind "workspace" requires a non-null workspaceId; kind "folder" requires a non-null folderPath',
		},
	);

function toRootInput(
	root: z.infer<typeof rootInputSchema>,
): WorkspaceGroupRootInput {
	return {
		kind: root.kind,
		workspaceId: root.workspaceId,
		folderPath: root.folderPath,
		label: root.label,
	};
}

/** Translate the store's not-found Error into a tRPC NOT_FOUND. */
function runStoreMutation<T>(fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Workspace group not found:")
		) {
			throw new TRPCError({ code: "NOT_FOUND", message: error.message });
		}
		if (error instanceof Error && error.message.startsWith("Cannot ")) {
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		}
		throw error;
	}
}

function resolveGroup(ctx: HostServiceContext, group: WorkspaceGroup) {
	return ctx.workspaceGroupResolver.resolveGroup(group);
}

export const workspaceGroupRouter = router({
	create: protectedProcedure
		.input(
			z.object({
				name: z.string(),
				roots: z.array(rootInputSchema).default([]),
			}),
		)
		.mutation(({ ctx, input }) => {
			const group = ctx.workspaceGroupStore.create({
				name: input.name,
				roots: input.roots.map(toRootInput),
			});
			return resolveGroup(ctx, group);
		}),

	get: queryProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) => {
			const group = ctx.workspaceGroupStore.get(input.id);
			if (!group) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Workspace group not found: ${input.id}`,
				});
			}
			return resolveGroup(ctx, group);
		}),

	list: queryProcedure.query(({ ctx }) => {
		return ctx.workspaceGroupStore
			.list()
			.map((group) => resolveGroup(ctx, group));
	}),

	rename: protectedProcedure
		.input(z.object({ id: z.string(), name: z.string() }))
		.mutation(({ ctx, input }) => {
			const group = runStoreMutation(() =>
				ctx.workspaceGroupStore.rename({ id: input.id, name: input.name }),
			);
			return resolveGroup(ctx, group);
		}),

	addRoot: protectedProcedure
		.input(z.object({ id: z.string(), root: rootInputSchema }))
		.mutation(({ ctx, input }) => {
			const group = runStoreMutation(() =>
				ctx.workspaceGroupStore.addRoot({
					id: input.id,
					root: toRootInput(input.root),
				}),
			);
			return resolveGroup(ctx, group);
		}),

	removeRoot: protectedProcedure
		.input(z.object({ id: z.string(), rootId: z.string() }))
		.mutation(({ ctx, input }) => {
			const group = runStoreMutation(() =>
				ctx.workspaceGroupStore.removeRoot({
					id: input.id,
					rootId: input.rootId,
				}),
			);
			return resolveGroup(ctx, group);
		}),

	reorderRoots: protectedProcedure
		.input(z.object({ id: z.string(), orderedRootIds: z.array(z.string()) }))
		.mutation(({ ctx, input }) => {
			const group = runStoreMutation(() =>
				ctx.workspaceGroupStore.reorderRoots({
					id: input.id,
					orderedRootIds: input.orderedRootIds,
				}),
			);
			return resolveGroup(ctx, group);
		}),

	setDefaultRoot: protectedProcedure
		.input(z.object({ id: z.string(), rootId: z.string().nullable() }))
		.mutation(({ ctx, input }) => {
			const group = runStoreMutation(() =>
				ctx.workspaceGroupStore.setDefaultRoot({
					id: input.id,
					rootId: input.rootId,
				}),
			);
			return resolveGroup(ctx, group);
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ ctx, input }) => {
			ctx.workspaceGroupStore.delete(input.id);
			return { id: input.id };
		}),
});
