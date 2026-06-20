import type { AppRouter as HostServiceAppRouter } from "@superset/host-service";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

type HostRouterOutputs = inferRouterOutputs<HostServiceAppRouter>;
type SearchBranchesResult =
	HostRouterOutputs["workspaceCreation"]["searchBranches"];
export type BranchSearchItem = SearchBranchesResult["items"][number];

/**
 * Stable query key for a host `workspaceCreation.searchBranches` page. Keyed by
 * host URL + project + the search query so each project/keystroke caches
 * independently.
 */
export function getBranchSearchQueryKey(input: {
	hostUrl: string | null;
	projectId: string | null;
	query: string;
}) {
	return [
		"workspaceGroup",
		"branchSearch",
		input.hostUrl,
		input.projectId,
		input.query,
	] as const;
}

/**
 * Wraps the host `workspaceCreation.searchBranches` procedure — the SAME branch
 * search the New Workspace flow uses to pick a compare base. Returns the first
 * page of branches for the given project, filtered by `query`. The host
 * already sorts default → reflog-recent → committerdate-desc, so the order is
 * the picker order. Same-host only (A1) via `getHostServiceClientByUrl`.
 */
export function useBranchSearch(input: {
	projectId: string | null;
	query: string;
	enabled?: boolean;
}): {
	branches: BranchSearchItem[];
	defaultBranch: string | null;
	isLoading: boolean;
	isReady: boolean;
} {
	const { activeHostUrl } = useLocalHostService();
	const trimmedQuery = input.query.trim();

	const branchQuery = useQuery({
		queryKey: getBranchSearchQueryKey({
			hostUrl: activeHostUrl,
			projectId: input.projectId,
			query: trimmedQuery,
		}),
		enabled:
			activeHostUrl !== null &&
			input.projectId !== null &&
			input.enabled !== false,
		queryFn: async () => {
			if (!activeHostUrl || !input.projectId) {
				return { defaultBranch: null, items: [], nextCursor: null };
			}
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.workspaceCreation.searchBranches.query({
				projectId: input.projectId,
				query: trimmedQuery || undefined,
				limit: 50,
			});
		},
	});

	const branches = useMemo(
		() => branchQuery.data?.items ?? [],
		[branchQuery.data?.items],
	);

	return {
		branches,
		defaultBranch: branchQuery.data?.defaultBranch ?? null,
		isLoading: branchQuery.isLoading,
		isReady: branchQuery.isSuccess,
	};
}
