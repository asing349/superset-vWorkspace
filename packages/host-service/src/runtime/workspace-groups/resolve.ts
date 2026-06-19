import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaces } from "../../db/schema.ts";
import type {
	ResolvedWorkspaceGroupRoot,
	WorkspaceGroup,
	WorkspaceGroupRoot,
} from "./types.ts";

export interface WorkspaceGroupResolverOptions {
	db: HostDb;
}

/**
 * Resolves a group's roots to absolute on-disk paths using existing host data.
 *
 * - `kind: "workspace"` → look up the host-local `workspaces` row and use its
 *   `worktreePath` (the same lookup `WorkspaceFilesystemManager.resolveWorkspaceRoot`
 *   performs).
 * - `kind: "folder"` → use `folderPath` directly.
 *
 * A root that can't be resolved (missing workspace row, or null path) is
 * surfaced as `rootPath: ""` with `exists: false` rather than throwing, so a
 * group with one stale root still renders.
 */
export class WorkspaceGroupResolver {
	private readonly db: HostDb;

	constructor(options: WorkspaceGroupResolverOptions) {
		this.db = options.db;
	}

	private resolveRootPath(root: WorkspaceGroupRoot): string {
		if (root.kind === "workspace") {
			if (!root.workspaceId) {
				return "";
			}
			const workspace = this.db.query.workspaces
				.findFirst({ where: eq(workspaces.id, root.workspaceId) })
				.sync();
			return workspace?.worktreePath ?? "";
		}
		return root.folderPath ?? "";
	}

	resolveRoot(root: WorkspaceGroupRoot): ResolvedWorkspaceGroupRoot {
		const rootPath = this.resolveRootPath(root);
		return {
			...root,
			rootPath,
			exists: rootPath !== "" && existsSync(rootPath),
		};
	}

	resolveRoots(roots: WorkspaceGroupRoot[]): ResolvedWorkspaceGroupRoot[] {
		return roots.map((root) => this.resolveRoot(root));
	}

	resolveGroup(group: WorkspaceGroup): {
		id: string;
		name: string;
		defaultRootId: string | null;
		createdAt: number;
		roots: ResolvedWorkspaceGroupRoot[];
	} {
		return {
			id: group.id,
			name: group.name,
			defaultRootId: group.defaultRootId,
			createdAt: group.createdAt,
			roots: this.resolveRoots(group.roots),
		};
	}

	/**
	 * Resolve a single root within a group to its absolute path. Used by the
	 * filesystem layer's `rootId` addressing. Throws when the group or root is
	 * unknown, or when the resolved path doesn't exist on disk.
	 */
	resolveRootPathById(input: {
		group: WorkspaceGroup;
		rootId: string;
	}): string {
		const root = input.group.roots.find((r) => r.rootId === input.rootId);
		if (!root) {
			throw new Error(
				`Root ${input.rootId} not found in group ${input.group.id}`,
			);
		}
		const resolved = this.resolveRoot(root);
		if (!resolved.exists) {
			throw new Error(
				`Root ${input.rootId} of group ${input.group.id} does not resolve to an existing path`,
			);
		}
		return resolved.rootPath;
	}
}
