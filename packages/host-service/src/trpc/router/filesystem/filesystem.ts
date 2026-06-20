import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, queryProcedure, router } from "../../index";

function expandTildeAbsolute(input: string): string {
	const trimmed = input.trim();
	if (trimmed.startsWith("~")) {
		const home = homedir();
		const rest = trimmed.slice(1);
		if (rest === "" || rest.startsWith("/") || rest.startsWith("\\")) {
			return normalize(join(home, rest));
		}
	}
	if (!isAbsolute(trimmed)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Path must be absolute or start with ~",
		});
	}
	return normalize(trimmed);
}

function getFilesystemService(ctx: HostServiceContext, workspaceId: string) {
	try {
		return ctx.runtime.filesystem.getServiceForWorkspace(workspaceId);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Workspace not found:")
		) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: error.message,
			});
		}
		throw error;
	}
}

/**
 * Translate the runtime's group-root resolution errors (unknown group, root not
 * in group, or a root that doesn't resolve to an existing path) into a tRPC
 * NOT_FOUND. Shared by `getServiceForRootId` and `resolveRootPath` callers so
 * the service-returning and path-returning group resolvers report identically.
 */
function rethrowRootResolveError(error: unknown): never {
	if (
		error instanceof Error &&
		(error.message.startsWith("Workspace group not found:") ||
			error.message.includes("not found in group") ||
			error.message.includes("does not resolve to an existing path"))
	) {
		throw new TRPCError({ code: "NOT_FOUND", message: error.message });
	}
	throw error;
}

/**
 * Resolve the FS service for a multi-root workspace ("group") root addressing.
 * Translates the runtime's not-found / unresolvable errors into tRPC codes.
 */
function getRootIdFilesystemService(
	ctx: HostServiceContext,
	input: { groupId: string; rootId: string },
) {
	try {
		return ctx.runtime.filesystem.getServiceForRootId(input);
	} catch (error) {
		rethrowRootResolveError(error);
	}
}

/**
 * Resolve the absolute on-disk root path for either addressing form. Mirrors
 * `pickService` but returns a path (not an FS service) — used by `statPath`,
 * which stats with `node:fs` directly and only needs the root for resolving
 * RELATIVE paths. The workspace form uses `resolveWorkspaceRoot`; the group
 * form uses `resolveRootPath` (serves folder roots with no `workspaceId`).
 */
function pickRootPath(ctx: HostServiceContext, addressing: Addressing): string {
	if ("workspaceId" in addressing) {
		try {
			return ctx.runtime.filesystem.resolveWorkspaceRoot(
				addressing.workspaceId,
			);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("Workspace not found:")
			) {
				throw new TRPCError({ code: "NOT_FOUND", message: error.message });
			}
			throw error;
		}
	}
	try {
		return ctx.runtime.filesystem.resolveRootPath(addressing);
	} catch (error) {
		rethrowRootResolveError(error);
	}
}

/**
 * Filesystem procedures — both reads and writes — accept EITHER the existing
 * workspace addressing (`{ workspaceId }`) OR a multi-root group addressing
 * (`{ groupId, rootId }`). This zod schema captures the discriminating fields;
 * `pickService` selects the matching FS service. Both forms then share the same
 * remaining input (the per-call path/options). The group form routes through
 * `getServiceForRootId`, which serves folder roots (no `workspaceId`) and reuses
 * the per-root-path cache. The underlying FS service enforces `isPathWithinRoot`
 * sandboxing and the path-based `ifMatch` optimistic-concurrency precondition
 * identically for either addressing — so widening writes here adds no new
 * conflict infra.
 */
const addressingSchema = z.union([
	z.object({ workspaceId: z.string() }),
	z.object({ groupId: z.string(), rootId: z.string() }),
]);

type Addressing = z.infer<typeof addressingSchema>;

function pickService(ctx: HostServiceContext, addressing: Addressing) {
	if ("workspaceId" in addressing) {
		return getFilesystemService(ctx, addressing.workspaceId);
	}
	return getRootIdFilesystemService(ctx, addressing);
}

/**
 * Split a procedure input into the FS service (selected by addressing) and the
 * remaining per-call fields the service expects. Strips both possible addressing
 * shapes so neither `workspaceId` nor `{ groupId, rootId }` leaks into the
 * service call. Shared by read and write procedures.
 */
function resolveServiceInput<T extends Addressing>(
	ctx: HostServiceContext,
	input: T,
) {
	const service = pickService(ctx, input);
	const { workspaceId, groupId, rootId, ...serviceInput } = input as T & {
		workspaceId?: string;
		groupId?: string;
		rootId?: string;
	};
	return { service, serviceInput };
}

function getProjectFilesystemService(
	ctx: HostServiceContext,
	projectId: string,
) {
	try {
		return ctx.runtime.filesystem.getServiceForProject(projectId);
	} catch (error) {
		// "Project not found" just means the repo hasn't been cloned on this host
		// yet (no workspace ever created for it). Return null so callers can degrade
		// gracefully rather than throwing a 404.
		if (
			error instanceof Error &&
			error.message.startsWith("Project not found:")
		) {
			return null;
		}
		throw error;
	}
}

const writeFileContentSchema = z.union([
	z.string(),
	z.object({
		kind: z.literal("base64"),
		data: z.string(),
	}),
]);

export const filesystemRouter = router({
	/**
	 * Browse any directory on the host filesystem. Unlike `listDirectory`,
	 * this is not scoped to a workspace — used by the project setup flow to
	 * pick a parent/repo path on a host that doesn't yet have a workspace.
	 *
	 * Path handling: absolute paths or ~-prefixed paths only. Returns the
	 * normalized absolute path along with subdirectory entries, sorted with
	 * dotfiles last.
	 */
	browseHost: protectedProcedure
		.input(
			z.object({
				path: z.string().optional(),
				includeHidden: z.boolean().optional(),
			}),
		)
		.query(async ({ input }) => {
			const targetPath = input.path
				? expandTildeAbsolute(input.path)
				: homedir();

			let stats: Awaited<ReturnType<typeof stat>>;
			try {
				stats = await stat(targetPath);
			} catch {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Path not found: ${targetPath}`,
				});
			}
			if (!stats.isDirectory()) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Not a directory: ${targetPath}`,
				});
			}

			let rawEntries: Array<{
				name: string;
				isDirectory: boolean;
				isSymlink: boolean;
			}>;
			try {
				const dirents = await readdir(targetPath, {
					withFileTypes: true,
					encoding: "utf8",
				});
				rawEntries = dirents.map((d) => ({
					name: d.name,
					isDirectory: d.isDirectory(),
					isSymlink: d.isSymbolicLink(),
				}));
			} catch (err) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						err instanceof Error
							? err.message
							: `Cannot read directory: ${targetPath}`,
				});
			}

			const entries = rawEntries
				.filter((e) => input.includeHidden || !e.name.startsWith("."))
				.sort((a, b) => {
					const aHidden = a.name.startsWith(".");
					const bHidden = b.name.startsWith(".");
					if (aHidden !== bHidden) return aHidden ? 1 : -1;
					if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
					return a.name.localeCompare(b.name);
				});

			const parent = dirname(targetPath);
			return {
				path: targetPath,
				parentPath: parent === targetPath ? null : parent,
				homePath: homedir(),
				entries,
			};
		}),

	listDirectory: queryProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
				}),
			),
		)
		.query(async ({ ctx, input, signal }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.listDirectory(serviceInput, { signal });
		}),

	readFile: queryProcedure
		.meta({ timeoutMs: 30_000 })
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
					offset: z.number().optional(),
					maxBytes: z.number().optional(),
					encoding: z.string().optional(),
				}),
			),
		)
		.query(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			const result = await service.readFile(serviceInput);

			if (result.kind === "bytes") {
				return {
					...result,
					content: Buffer.from(result.content).toString("base64"),
				};
			}

			return result;
		}),

	getMetadata: queryProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
				}),
			),
		)
		.query(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.getMetadata(serviceInput);
		}),

	/**
	 * Resolve a path (absolute or relative) against the workspace root and
	 * check if it exists. Used by the terminal link detector to validate
	 * file paths before showing them as clickable links.
	 *
	 * Accepts:
	 * - Absolute paths: /foo/bar → stat directly (must be within workspace)
	 * - Relative paths: src/file.ts → resolved against workspace root
	 * - Tilde paths: ~/foo → resolved against $HOME
	 *
	 * Addressing (Wave-2 M7): accepts EITHER `{ workspaceId }` (original) OR
	 * `{ groupId, rootId }`. The group form resolves the root via
	 * `resolveRootPath`, so relative paths in the combined-agent / folder-root
	 * terminal output become statt-able (and thus clickable) for folder roots
	 * (which have no `workspaceId`). The same shared `addressingSchema` the read
	 * and write procedures use; only the relative-path base root differs by form.
	 */
	statPath: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					path: z.string(),
				}),
			),
		)
		.mutation(
			async ({
				ctx,
				input,
			}): Promise<{
				resolvedPath: string;
				isDirectory: boolean;
			} | null> => {
				const resolvedRoot = pickRootPath(ctx, input);

				let targetPath: string;
				if (input.path.startsWith("~")) {
					const home = process.env.HOME ?? process.env.USERPROFILE;
					if (!home) return null;
					targetPath = join(home, input.path.substring(1));
				} else if (isAbsolute(input.path)) {
					// Absolute paths are intentionally not confined to the workspace
					// root — terminal output can reference files anywhere on the host
					// (e.g. /usr/local/bin/node, stack traces). This endpoint is
					// behind protectedProcedure so only authenticated clients can call it.
					targetPath = normalize(input.path);
				} else {
					targetPath = resolve(resolvedRoot, input.path);
				}

				try {
					const stats = await stat(targetPath);
					return {
						resolvedPath: targetPath,
						isDirectory: stats.isDirectory(),
					};
				} catch {
					return null;
				}
			},
		),

	writeFile: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
					content: writeFileContentSchema,
					encoding: z.string().optional(),
					options: z
						.object({
							create: z.boolean(),
							overwrite: z.boolean(),
						})
						.optional(),
					precondition: z
						.object({
							ifMatch: z.string(),
						})
						.optional(),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			const { content: rawContent, ...rest } = serviceInput;
			const content =
				typeof rawContent === "string"
					? rawContent
					: new Uint8Array(Buffer.from(rawContent.data, "base64"));

			return await service.writeFile({
				...rest,
				content,
			});
		}),

	createDirectory: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
					recursive: z.boolean().optional(),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.createDirectory(serviceInput);
		}),

	deletePath: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					absolutePath: z.string(),
					permanent: z.boolean().optional(),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.deletePath(serviceInput);
		}),

	movePath: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					sourceAbsolutePath: z.string(),
					destinationAbsolutePath: z.string(),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.movePath(serviceInput);
		}),

	copyPath: protectedProcedure
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					sourceAbsolutePath: z.string(),
					destinationAbsolutePath: z.string(),
				}),
			),
		)
		.mutation(async ({ ctx, input }) => {
			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.copyPath(serviceInput);
		}),

	/**
	 * File-name search. Accepts three addressing forms (additive — the first two
	 * are the original contract; the third was added for cross-root search):
	 * - `{ workspaceId }`        — a single workspace's worktree.
	 * - `{ projectId }`          — a project's repo (degrades to `{ matches: [] }`
	 *                              when the repo isn't cloned on this host).
	 * - `{ groupId, rootId }`    — one root of a multi-root workspace ("group"),
	 *                              including `kind: "folder"` roots with no
	 *                              workspaceId. The renderer fans out one call per
	 *                              root and merges; this procedure stays single-root.
	 */
	searchFiles: queryProcedure
		.meta({ timeoutMs: 30_000 })
		.input(
			z
				.object({
					workspaceId: z.string().optional(),
					projectId: z.string().optional(),
					groupId: z.string().optional(),
					rootId: z.string().optional(),
					query: z.string(),
					includeHidden: z.boolean().optional(),
					includePattern: z.string().optional(),
					excludePattern: z.string().optional(),
					limit: z.number().optional(),
				})
				.refine((v) => {
					const hasGroupRoot = !!v.groupId && !!v.rootId;
					// `groupId`/`rootId` must be supplied together.
					if (!!v.groupId !== !!v.rootId) return false;
					// Exactly one addressing form among workspace / project / group-root.
					const forms = [!!v.workspaceId, !!v.projectId, hasGroupRoot].filter(
						Boolean,
					);
					return forms.length === 1;
				}, "Provide exactly one addressing: { workspaceId }, { projectId }, or { groupId, rootId }"),
		)
		.query(async ({ ctx, input }) => {
			const trimmedQuery = input.query.trim();
			if (!trimmedQuery) {
				return { matches: [] };
			}

			const { workspaceId, projectId, groupId, rootId, ...serviceInput } =
				input;
			let service: ReturnType<typeof getFilesystemService> | null;
			if (groupId && rootId) {
				service = getRootIdFilesystemService(ctx, { groupId, rootId });
			} else if (workspaceId) {
				service = getFilesystemService(ctx, workspaceId);
			} else {
				service = getProjectFilesystemService(ctx, projectId as string);
			}
			if (!service) {
				return { matches: [] };
			}

			return await service.searchFiles({
				...serviceInput,
				query: trimmedQuery,
			});
		}),

	/**
	 * File-content search. Accepts EITHER `{ workspaceId }` (original) OR
	 * `{ groupId, rootId }` (added for cross-root search, including folder roots).
	 * The renderer fans out per root and merges; this procedure stays single-root.
	 */
	searchContent: queryProcedure
		.meta({ timeoutMs: 60_000 })
		.input(
			z.intersection(
				addressingSchema,
				z.object({
					query: z.string(),
					includeHidden: z.boolean().optional(),
					includePattern: z.string().optional(),
					excludePattern: z.string().optional(),
					limit: z.number().optional(),
				}),
			),
		)
		.query(async ({ ctx, input }) => {
			const trimmedQuery = input.query.trim();
			if (!trimmedQuery) {
				return { matches: [] };
			}

			const { service, serviceInput } = resolveServiceInput(ctx, input);
			return await service.searchContent({
				...serviceInput,
				query: trimmedQuery,
			});
		}),
});
