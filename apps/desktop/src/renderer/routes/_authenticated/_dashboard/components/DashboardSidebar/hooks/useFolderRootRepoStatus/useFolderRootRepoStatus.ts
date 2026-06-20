import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export interface FolderRootRepoProbe {
	/** The group root id this probe is for. */
	rootId: string;
	/** The folder root's absolute path. */
	folderPath: string;
}

/**
 * Stable query key for a single folder-root repo probe (Wave-2 M4). Keyed by host
 * URL + the folder path, so two roots over the same path share the cache.
 */
export function getFolderRootRepoStatusQueryKey(
	hostUrl: string | null,
	folderPath: string,
) {
	return [
		"workspaceGroup",
		"folderRootRepoStatus",
		hostUrl,
		folderPath,
	] as const;
}

/**
 * Probes a set of `kind:"folder"` roots to detect which are actually git repos
 * (and therefore promotable to first-class worktree roots — Wave-2 M4). Detection
 * reuses the SAME host `project.findByPath` procedure the import flow uses: a
 * folder is a git repo when the response does NOT carry `needsGitInit`. We do not
 * resolve setup/create here (no side effects) — only classify — so the manage
 * dialog can decide whether to show the "Promote to repo" action.
 *
 * Each folder path is probed independently (one query per path, deduped by path)
 * so adding/removing roots only refetches what changed. Same-host only (A1).
 */
export function useFolderRootRepoStatus(probes: FolderRootRepoProbe[]): {
	/** rootIds whose folder path is a git repo (promotable). */
	promotableRootIds: Set<string>;
} {
	const { activeHostUrl } = useLocalHostService();

	// Dedupe by path: two folder roots can point at the same directory.
	const uniquePaths = useMemo(() => {
		return Array.from(new Set(probes.map((probe) => probe.folderPath)));
	}, [probes]);

	const results = useQueries({
		queries: uniquePaths.map((folderPath) => ({
			queryKey: getFolderRootRepoStatusQueryKey(activeHostUrl, folderPath),
			enabled: activeHostUrl !== null && folderPath.length > 0,
			// A folder either is or isn't a repo; it changes rarely. Avoid
			// re-probing the host on every dialog focus.
			staleTime: 30_000,
			queryFn: async (): Promise<boolean> => {
				if (!activeHostUrl) return false;
				const client = getHostServiceClientByUrl(activeHostUrl);
				const response = await client.project.findByPath.query({
					repoPath: folderPath,
				});
				return !("needsGitInit" in response && response.needsGitInit);
			},
		})),
	});

	const isRepoByPath = useMemo(() => {
		const map = new Map<string, boolean>();
		uniquePaths.forEach((folderPath, index) => {
			map.set(folderPath, results[index]?.data === true);
		});
		return map;
	}, [uniquePaths, results]);

	const promotableRootIds = useMemo(() => {
		const set = new Set<string>();
		for (const probe of probes) {
			if (isRepoByPath.get(probe.folderPath)) set.add(probe.rootId);
		}
		return set;
	}, [probes, isRepoByPath]);

	return { promotableRootIds };
}
