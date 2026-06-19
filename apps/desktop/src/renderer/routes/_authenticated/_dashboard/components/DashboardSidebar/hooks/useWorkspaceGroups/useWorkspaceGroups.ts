import type { AppRouter as HostServiceAppRouter } from "@superset/host-service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useMemo } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

type HostRouterOutputs = inferRouterOutputs<HostServiceAppRouter>;
export type ResolvedWorkspaceGroup = HostRouterOutputs["workspaceGroup"]["get"];
export type ResolvedWorkspaceGroupRoot =
	ResolvedWorkspaceGroup["roots"][number];
export type WorkspaceGroupRootInput = Parameters<
	ReturnType<
		typeof getHostServiceClientByUrl
	>["workspaceGroup"]["addRoot"]["mutate"]
>[0]["root"];

/**
 * Stable query key for the host-service `workspaceGroup.list` result. The
 * dashboard sidebar (the app-level React Query client) owns this query; every
 * `workspaceGroup.*` mutation invalidates it so the sidebar list reflects the
 * change immediately.
 */
export function getWorkspaceGroupsListQueryKey(hostUrl: string | null) {
	return ["workspaceGroup", "list", hostUrl] as const;
}

export interface UseWorkspaceGroupsResult {
	/** Resolved groups from `workspaceGroup.list`, sorted oldest-first. */
	groups: ResolvedWorkspaceGroup[];
	/** True once the list query has resolved at least once. */
	isReady: boolean;
	/** The local host URL the groups are served from (null when unavailable). */
	hostUrl: string | null;
	/** Refetch `workspaceGroup.list` (the sidebar list). */
	invalidateList: () => Promise<void>;
	create: (input: {
		name: string;
		roots?: WorkspaceGroupRootInput[];
	}) => Promise<ResolvedWorkspaceGroup>;
	rename: (input: {
		id: string;
		name: string;
	}) => Promise<ResolvedWorkspaceGroup>;
	addRoot: (input: {
		id: string;
		root: WorkspaceGroupRootInput;
	}) => Promise<ResolvedWorkspaceGroup>;
	removeRoot: (input: {
		id: string;
		rootId: string;
	}) => Promise<ResolvedWorkspaceGroup>;
	reorderRoots: (input: {
		id: string;
		orderedRootIds: string[];
	}) => Promise<ResolvedWorkspaceGroup>;
	setDefaultRoot: (input: {
		id: string;
		rootId: string | null;
	}) => Promise<ResolvedWorkspaceGroup>;
	deleteGroup: (input: { id: string }) => Promise<void>;
}

/**
 * Lists and mutates multi-root workspaces ("groups") from the dashboard
 * sidebar. Groups are a local-only, same-host grouping (Decision Log:
 * local-only scope; A1: same host), so all calls go to the local host URL via
 * `getHostServiceClientByUrl(activeHostUrl)`.
 *
 * After every mutation the sidebar `list` query is invalidated so the sidebar
 * reflects the change immediately. The open group route runs its own
 * `workspaceGroup.get` in a separate per-host query client (see
 * `WorkspaceGroupProvider`); callers that have a group open should pass
 * `refetchGroup` from `useWorkspaceGroup()` into the management dialog so that
 * connection refreshes too.
 */
export function useWorkspaceGroups(): UseWorkspaceGroupsResult {
	const { activeHostUrl } = useLocalHostService();
	const queryClient = useQueryClient();

	const listQuery = useQuery({
		queryKey: getWorkspaceGroupsListQueryKey(activeHostUrl),
		enabled: activeHostUrl !== null,
		queryFn: async () => {
			if (!activeHostUrl) return [];
			const client = getHostServiceClientByUrl(activeHostUrl);
			return client.workspaceGroup.list.query();
		},
	});

	const invalidateList = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: getWorkspaceGroupsListQueryKey(activeHostUrl),
		});
	}, [activeHostUrl, queryClient]);

	const requireClient = useCallback(() => {
		if (!activeHostUrl) {
			throw new Error(
				"The local host service is not available. Multi-root workspaces require a running host.",
			);
		}
		return getHostServiceClientByUrl(activeHostUrl);
	}, [activeHostUrl]);

	const create = useCallback<UseWorkspaceGroupsResult["create"]>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.create.mutate({
				name: input.name,
				roots: input.roots ?? [],
			});
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const rename = useCallback<UseWorkspaceGroupsResult["rename"]>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.rename.mutate(input);
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const addRoot = useCallback<UseWorkspaceGroupsResult["addRoot"]>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.addRoot.mutate(input);
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const removeRoot = useCallback<UseWorkspaceGroupsResult["removeRoot"]>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.removeRoot.mutate(input);
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const reorderRoots = useCallback<UseWorkspaceGroupsResult["reorderRoots"]>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.reorderRoots.mutate(input);
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const setDefaultRoot = useCallback<
		UseWorkspaceGroupsResult["setDefaultRoot"]
	>(
		async (input) => {
			const client = requireClient();
			const group = await client.workspaceGroup.setDefaultRoot.mutate(input);
			await invalidateList();
			return group;
		},
		[invalidateList, requireClient],
	);

	const deleteGroup = useCallback<UseWorkspaceGroupsResult["deleteGroup"]>(
		async (input) => {
			const client = requireClient();
			await client.workspaceGroup.delete.mutate(input);
			await invalidateList();
		},
		[invalidateList, requireClient],
	);

	const groups = useMemo(() => {
		const rows = listQuery.data ?? [];
		return [...rows].sort((a, b) => a.createdAt - b.createdAt);
	}, [listQuery.data]);

	return {
		groups,
		isReady: listQuery.isSuccess,
		hostUrl: activeHostUrl,
		invalidateList,
		create,
		rename,
		addRoot,
		removeRoot,
		reorderRoots,
		setDefaultRoot,
		deleteGroup,
	};
}
