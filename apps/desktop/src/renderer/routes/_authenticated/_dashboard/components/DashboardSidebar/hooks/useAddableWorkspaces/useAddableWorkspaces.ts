import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface AddableWorkspace {
	/** The host-local workspace id — the value sent as a root's `workspaceId`. */
	id: string;
	name: string;
	branch: string;
	projectName: string;
}

/**
 * Lists the local-host worktrees (Superset "workspaces") that can be added to a
 * multi-root workspace as `kind: "workspace"` roots. Only local-device
 * workspaces are addable — a group is a same-host grouping (A1), and a root's
 * `workspaceId` must resolve to a `worktreePath` in the local host's
 * `workspaces` table.
 *
 * Cache-first per AGENTS.md rule #9: rows already in the `v2Workspaces`
 * collection render immediately even before the collection is `isReady`.
 */
export function useAddableWorkspaces(): {
	workspaces: AddableWorkspace[];
	isReady: boolean;
} {
	const collections = useCollections();
	const { machineId } = useLocalHostService();

	const { data: rows = [], isReady } = useLiveQuery(
		(q) =>
			q
				.from({ workspaces: collections.v2Workspaces })
				.innerJoin(
					{ projects: collections.v2Projects },
					({ workspaces, projects }) => eq(workspaces.projectId, projects.id),
				)
				.where(({ workspaces }) => eq(workspaces.hostId, machineId))
				.orderBy(({ workspaces }) => workspaces.name, "asc")
				.select(({ workspaces, projects }) => ({
					id: workspaces.id,
					name: workspaces.name,
					branch: workspaces.branch,
					projectName: projects.name,
				})),
		[collections, machineId],
	);

	const workspaces = useMemo<AddableWorkspace[]>(
		() =>
			rows.map((row) => ({
				id: row.id,
				name: row.name,
				branch: row.branch,
				projectName: row.projectName,
			})),
		[rows],
	);

	return { workspaces, isReady };
}
