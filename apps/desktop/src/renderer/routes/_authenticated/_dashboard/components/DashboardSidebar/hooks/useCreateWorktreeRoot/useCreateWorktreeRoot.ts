import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface CreateWorktreeInput {
	/** A registered host project id (from `useWorktreeProjects`). */
	projectId: string;
	/** The new branch to create the worktree on. */
	branch: string;
	/** Optional base branch to branch the new worktree from. */
	baseBranch?: string;
	/** Optional workspace display name; defaults to the branch on the host. */
	name?: string;
}

export interface CreatedWorktree {
	/**
	 * The host-local workspace id of the freshly created worktree — the value
	 * to pass as a `kind:"workspace"` root's `workspaceId`. The host
	 * `workspaces.create` procedure writes this exact id into the host
	 * `workspaces` table, so it resolves in `workspaceGroup.addRoot`.
	 */
	workspaceId: string;
	/** Display label for the root (the workspace name the host assigned). */
	label: string;
	/**
	 * True when the host found and reused an existing worktree for this
	 * (project, branch) instead of creating a fresh one. The (project, branch)
	 * create path is idempotent; this lets the caller surface a softer message.
	 */
	alreadyExists: boolean;
}

/**
 * Step 1 of the Wave-2 M3 renderer two-step: create a fresh worktree in an
 * already-imported project by driving the host `workspaces.create` procedure
 * directly (the SAME procedure the New Workspace flow's create path ultimately
 * registers a worktree through). It is driven over the host connection — NOT
 * the Electron-main `electronTrpc.workspaces.create` hook — because only the
 * host procedure writes the resulting workspace row into the host `workspaces`
 * table, which is what `workspaceGroup.addRoot`'s resolver reads. Using the
 * Electron path would create a worktree whose id is invisible to the group
 * resolver (an unaddable orphan).
 *
 * This hook intentionally does NOT add the root. The caller runs step 2 —
 * either `workspaceGroup.addRoot` (an open/managed group) or accumulating the
 * root for a single `workspaceGroup.create` call (the create dialog) — mirroring
 * the existing `AddRootMenu` `onAddRoot` contract. Host errors (branch already
 * checked out, dirty tree, clone needed) propagate unchanged so the caller can
 * surface the host's own message, exactly like the New Workspace modal.
 *
 * Same-host only (A1): all calls go to the local host URL.
 */
export function useCreateWorktreeRoot(): {
	createWorktree: (input: CreateWorktreeInput) => Promise<CreatedWorktree>;
} {
	const { activeHostUrl } = useLocalHostService();

	const createWorktree = useCallback(
		async (input: CreateWorktreeInput): Promise<CreatedWorktree> => {
			if (!activeHostUrl) {
				throw new Error(
					"The local host service is not available. Creating a worktree requires a running host.",
				);
			}
			const client = getHostServiceClientByUrl(activeHostUrl);
			const result = await client.workspaces.create.mutate({
				projectId: input.projectId,
				branch: input.branch,
				baseBranch: input.baseBranch,
				name: input.name,
			});
			return {
				workspaceId: result.workspace.id,
				label: result.workspace.name ?? input.name ?? input.branch,
				alreadyExists: result.alreadyExists,
			};
		},
		[activeHostUrl],
	);

	return { createWorktree };
}
