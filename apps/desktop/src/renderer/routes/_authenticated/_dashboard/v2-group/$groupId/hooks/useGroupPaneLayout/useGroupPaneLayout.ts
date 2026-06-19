import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo, useRef } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { PaneViewerData } from "../../../../v2-workspace/$workspaceId/types";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};

function getSnapshot(state: WorkspaceState<PaneViewerData>): string {
	return JSON.stringify(state);
}

/**
 * Group-scoped pane store + renderer-local layout persistence, mirroring
 * `useV2WorkspacePaneLayout` but keyed by `groupId` and persisting into the
 * `v2WorkspaceGroupLocalState` collection. The store is memoized on `[groupId]`
 * (and the rendered `Workspace` is keyed by `groupId`), so a group's pane state
 * is fully distinct from any single-workspace store — switching between a group
 * route and a single-workspace route never leaks panes across the boundary.
 */
export function useGroupPaneLayout() {
	const { groupId } = useWorkspaceGroup();
	const collections = useCollections();
	// Keep the volatile pane store scoped to the route group. Memoizing on
	// [groupId] (and keying the rendered Workspace on groupId) guarantees a fresh
	// store per group so panes never carry over from another group or workspace.
	const groupRuntime = useMemo(
		() => ({
			groupId,
			store: createWorkspaceStore<PaneViewerData>({
				initialState: EMPTY_STATE,
			}),
		}),
		[groupId],
	);
	const { store } = groupRuntime;
	const syncStateRef = useRef({
		groupId,
		lastSyncedSnapshot: getSnapshot(EMPTY_STATE),
	});

	const { data: localGroupRows = [] } = useLiveQuery(
		(query) =>
			query
				.from({
					v2WorkspaceGroupLocalState: collections.v2WorkspaceGroupLocalState,
				})
				.where(({ v2WorkspaceGroupLocalState }) =>
					eq(v2WorkspaceGroupLocalState.groupId, groupId),
				),
		[collections, groupId],
	);
	const localGroupState =
		localGroupRows.find((row) => row.groupId === groupId) ?? null;
	const persistedPaneLayout = useMemo(
		() =>
			localGroupState?.groupId === groupId
				? ((localGroupState.paneLayout as
						| WorkspaceState<PaneViewerData>
						| undefined) ?? EMPTY_STATE)
				: EMPTY_STATE,
		[localGroupState, groupId],
	);

	useEffect(() => {
		syncStateRef.current = {
			groupId,
			lastSyncedSnapshot: getSnapshot(EMPTY_STATE),
		};
	}, [groupId]);

	useEffect(() => {
		const nextSnapshot = getSnapshot(persistedPaneLayout);
		if (nextSnapshot === syncStateRef.current.lastSyncedSnapshot) {
			return;
		}

		syncStateRef.current.lastSyncedSnapshot = nextSnapshot;
		store.getState().replaceState(persistedPaneLayout);
	}, [persistedPaneLayout, store]);

	useEffect(() => {
		const unsubscribe = store.subscribe((nextStore) => {
			const nextGroupState: WorkspaceState<PaneViewerData> = {
				version: nextStore.version,
				tabs: nextStore.tabs,
				activeTabId: nextStore.activeTabId,
			};
			const nextSnapshot = getSnapshot(nextGroupState);
			if (nextSnapshot === syncStateRef.current.lastSyncedSnapshot) {
				return;
			}

			// Seed the row on first persist so the update target exists. Unlike the
			// single-workspace layout (whose row is seeded by the sidebar), groups
			// have no other writer of this collection, so the layout hook owns
			// creation.
			if (!collections.v2WorkspaceGroupLocalState.get(groupId)) {
				collections.v2WorkspaceGroupLocalState.insert({
					groupId,
					createdAt: new Date(),
					paneLayout: nextGroupState,
				});
				syncStateRef.current.lastSyncedSnapshot = nextSnapshot;
				return;
			}

			collections.v2WorkspaceGroupLocalState.update(groupId, (draft) => {
				draft.paneLayout = nextGroupState;
			});
			syncStateRef.current.lastSyncedSnapshot = nextSnapshot;
		});

		return () => {
			unsubscribe();
		};
	}, [collections, store, groupId]);

	return { store };
}
