import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getBaseName } from "renderer/lib/pathBasename";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface WorktreeProject {
	/**
	 * The host-local project id. This is the cloud `v2Project.id`, which the
	 * host writes verbatim into its `projects` table, so it is exactly the
	 * `projectId` the host `workspaces.create` procedure requires
	 * (`requireLocalProject`).
	 */
	id: string;
	/** Friendly display name (cloud `v2Projects.name` when known). */
	name: string;
	/** The repo's main checkout path on disk (for a secondary label). */
	repoPath: string;
}

/**
 * Stable query key for the host-service `project.list` result. This list runs
 * on whatever React Query client the consumer is mounted under; keying by host
 * URL keeps it isolated per host.
 */
export function getWorktreeProjectsQueryKey(hostUrl: string | null) {
	return ["workspaceGroup", "worktreeProjects", hostUrl] as const;
}

/**
 * Lists the already-imported projects on the local host that a new worktree can
 * be created in (Wave-2 M3). The authoritative source is the host's own
 * `project.list` — its `id` is the exact value `workspaces.create` resolves via
 * `requireLocalProject`, and only registered projects appear (importing a
 * brand-new repo by folder is M4, not M3). Display names are enriched from the
 * cloud-synced `v2Projects` collection when available, falling back to the
 * repo's directory basename.
 *
 * Same-host only (A1): the call goes to the local host URL via
 * `getHostServiceClientByUrl(activeHostUrl)`, mirroring `useWorkspaceGroups`.
 */
export function useWorktreeProjects(): {
	projects: WorktreeProject[];
	isReady: boolean;
} {
	const { activeHostUrl } = useLocalHostService();
	const collections = useCollections();

	const listQuery = useQuery({
		queryKey: getWorktreeProjectsQueryKey(activeHostUrl),
		enabled: activeHostUrl !== null,
		queryFn: async () => {
			if (!activeHostUrl) return [];
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.project.list.query();
		},
	});

	// Cache-first per AGENTS.md rule #9: render any names already present in the
	// collection immediately; this query only enriches labels, never gates the
	// (host-authoritative) project list.
	const { data: projectNameRows = [] } = useLiveQuery(
		(q) =>
			q
				.from({ projects: collections.v2Projects })
				.select(({ projects }) => ({ id: projects.id, name: projects.name })),
		[collections],
	);

	const nameById = useMemo(() => {
		const map = new Map<string, string>();
		for (const row of projectNameRows) {
			if (row.id) map.set(row.id, row.name);
		}
		return map;
	}, [projectNameRows]);

	const projects = useMemo<WorktreeProject[]>(() => {
		const rows = listQuery.data ?? [];
		return rows
			.map((row) => ({
				id: row.id,
				name: nameById.get(row.id) ?? getBaseName(row.repoPath),
				repoPath: row.repoPath,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [listQuery.data, nameById]);

	return { projects, isReady: listQuery.isSuccess };
}
