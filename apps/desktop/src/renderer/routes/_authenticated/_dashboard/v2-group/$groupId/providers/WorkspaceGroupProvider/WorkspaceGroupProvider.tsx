import type { AppRouter as HostServiceAppRouter } from "@superset/host-service";
import { workspaceTrpc } from "@superset/workspace-client";
import type { inferRouterOutputs } from "@trpc/server";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
	getHostServiceHeaders,
	getHostServiceWsToken,
} from "renderer/lib/host-service-auth";
import { WorkspaceTrpcProvider } from "../../../../v2-workspace/providers/WorkspaceTrpcProvider";

type ResolvedGroup =
	inferRouterOutputs<HostServiceAppRouter>["workspaceGroup"]["get"];
export type ResolvedGroupRoot = ResolvedGroup["roots"][number];

interface WorkspaceGroupContextValue {
	groupId: string;
	/** The resolved group (id, name, defaultRootId, roots with rootPath/exists). */
	group: ResolvedGroup;
	/** The group's resolved roots in `position` order. */
	roots: ResolvedGroupRoot[];
	/**
	 * The group's default root, resolved from `defaultRootId`. Falls back to the
	 * first root when no default is set, and is `null` only for an empty group.
	 */
	defaultRoot: ResolvedGroupRoot | null;
	/** The per-host URL this group's roots are served from (all same host, A1). */
	hostUrl: string;
	/** Refetch the resolved group (e.g. after a root is added/removed in M5). */
	refetchGroup: () => void;
}

const WorkspaceGroupContext = createContext<WorkspaceGroupContextValue | null>(
	null,
);

/**
 * Opens exactly one per-host `WorkspaceClientProvider` for a multi-root
 * workspace ("group"), queries `workspaceGroup.get` within that single
 * connection, and exposes the resolved group, its roots, and its default root
 * via `useWorkspaceGroup()`.
 *
 * Host selection (A1 — all roots live on the same host): groups are a
 * local-only, same-host grouping (see the plan's Decision Log), and the
 * in-memory group store lives on the local host. So the group connects to the
 * local host URL passed in by the layout; `workspaceGroup.get` is queried
 * within that single connection. There is exactly one host connection per
 * group, mirroring the single-workspace shell's one-connection-per-workspace.
 */
export function WorkspaceGroupProvider({
	groupId,
	hostUrl,
	renderLoading,
	renderNotFound,
	children,
}: {
	groupId: string;
	hostUrl: string;
	renderLoading: () => ReactNode;
	renderNotFound: () => ReactNode;
	children: ReactNode;
}) {
	return (
		<WorkspaceTrpcProvider
			cacheKey={groupId}
			key={`${groupId}:${hostUrl}`}
			hostUrl={hostUrl}
			headers={() => getHostServiceHeaders(hostUrl)}
			wsToken={() => getHostServiceWsToken(hostUrl)}
		>
			<WorkspaceGroupContextProvider
				groupId={groupId}
				hostUrl={hostUrl}
				renderLoading={renderLoading}
				renderNotFound={renderNotFound}
			>
				{children}
			</WorkspaceGroupContextProvider>
		</WorkspaceTrpcProvider>
	);
}

function WorkspaceGroupContextProvider({
	groupId,
	hostUrl,
	renderLoading,
	renderNotFound,
	children,
}: {
	groupId: string;
	hostUrl: string;
	renderLoading: () => ReactNode;
	renderNotFound: () => ReactNode;
	children: ReactNode;
}) {
	const groupQuery = workspaceTrpc.workspaceGroup.get.useQuery(
		{ id: groupId },
		{ retry: false },
	);
	const group = groupQuery.data ?? null;

	const roots = useMemo(
		() =>
			group ? [...group.roots].sort((a, b) => a.position - b.position) : [],
		[group],
	);
	const defaultRoot = useMemo(() => {
		if (!group || roots.length === 0) return null;
		const byDefaultId = group.defaultRootId
			? (roots.find((root) => root.rootId === group.defaultRootId) ?? null)
			: null;
		return byDefaultId ?? roots[0] ?? null;
	}, [group, roots]);

	const value = useMemo<WorkspaceGroupContextValue | null>(
		() =>
			group
				? {
						groupId,
						group,
						roots,
						defaultRoot,
						hostUrl,
						refetchGroup: () => {
							void groupQuery.refetch();
						},
					}
				: null,
		[group, groupId, roots, defaultRoot, hostUrl, groupQuery],
	);

	if (!value) {
		if (groupQuery.isLoading) return <>{renderLoading()}</>;
		return <>{renderNotFound()}</>;
	}

	return (
		<WorkspaceGroupContext.Provider value={value}>
			{children}
		</WorkspaceGroupContext.Provider>
	);
}

export function useWorkspaceGroup(): WorkspaceGroupContextValue {
	const ctx = useContext(WorkspaceGroupContext);
	if (!ctx) {
		throw new Error(
			"useWorkspaceGroup must be used within WorkspaceGroupProvider",
		);
	}
	return ctx;
}
