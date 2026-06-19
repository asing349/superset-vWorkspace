/**
 * Shared types for multi-root workspaces ("groups"). A group is a named,
 * ordered list of roots; each root points either at an existing Superset
 * worktree (`kind: "workspace"`) or an arbitrary local folder
 * (`kind: "folder"`). These types are the M1 contract that the renderer and
 * sibling routers code against — field names are load-bearing.
 */

export type WorkspaceGroupRootKind = "workspace" | "folder";

export interface WorkspaceGroupRoot {
	/** Unique within the group. Assigned by the store. */
	rootId: string;
	kind: WorkspaceGroupRootKind;
	/** Set when `kind === "workspace"`, else null. */
	workspaceId: string | null;
	/** Set when `kind === "folder"`, else null. */
	folderPath: string | null;
	/** Display name (defaults to repo/folder basename). */
	label: string;
	/** Ordering within the group; maintained as the array index by the store. */
	position: number;
}

export interface WorkspaceGroup {
	id: string;
	name: string;
	defaultRootId: string | null;
	roots: WorkspaceGroupRoot[];
	createdAt: number;
}

export interface ResolvedWorkspaceGroupRoot extends WorkspaceGroupRoot {
	/** Absolute path resolved on this host. */
	rootPath: string;
	/** Whether `rootPath` currently exists on disk. */
	exists: boolean;
}
