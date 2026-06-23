import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";
import {
	type FileSearchRootMatches,
	type GroupFileSearchResult,
	mergeFileSearchResults,
} from "./utils/mergeFileSearchResults";

export type { GroupFileSearchResult } from "./utils/mergeFileSearchResults";

const SEARCH_LIMIT_PER_ROOT = 50;
const MERGED_RESULT_LIMIT = 50;

// Cross-root CONTENT search shipped in wave-2 M8 (`useGroupContentSearch` +
// `GroupContentSearch`), which fans out `filesystem.searchContent` per root and
// merges with per-root labels. This hook is the file-NAME quick-open sibling.

/**
 * Cross-root quick-open search (Q4 fan-out-and-merge).
 *
 * Fans out one `filesystem.searchFiles({ groupId, rootId, query })` call per
 * resolved root that currently exists on disk (roots with `exists: false` are
 * skipped — their FS service can't be created), runs them in PARALLEL over the
 * single per-host connection via `workspaceTrpc.useQueries`, then merges every
 * root's matches into one list. Each result is stamped with its owning root's
 * `rootId` + `label`, and the merged list is interleaved by the host's fuzzy
 * `score` (descending) so the most relevant match wins regardless of which root
 * it lives in. Results are de-duplicated by `(rootId, absolutePath)` — the same
 * relative path under two different roots is intentionally kept as two distinct
 * entries (they open as distinct panes).
 *
 * The per-root query is disabled until there's a query string, so an idle
 * overlay issues no host calls.
 */
export function useGroupFileSearch(query: string): {
	results: GroupFileSearchResult[];
	isFetching: boolean;
} {
	const { groupId, roots } = useWorkspaceGroup();
	const trimmedQuery = query.trim();
	const hasQuery = trimmedQuery.length > 0;

	// Only roots that resolve to an existing path can be searched. `exists:false`
	// roots (e.g. a deleted worktree) have no FS service on the host.
	const searchableRoots = useMemo(
		() => roots.filter((root) => root.exists),
		[roots],
	);

	const queries = workspaceTrpc.useQueries((t) =>
		searchableRoots.map((root) =>
			t.filesystem.searchFiles(
				{
					groupId,
					rootId: root.rootId,
					query: trimmedQuery,
					limit: SEARCH_LIMIT_PER_ROOT,
				},
				{
					enabled: hasQuery,
					placeholderData: (previous) => previous ?? { matches: [] },
				},
			),
		),
	);

	const isFetching = queries.some((q) => q.isFetching);

	const results = useMemo<GroupFileSearchResult[]>(() => {
		if (!hasQuery) return [];

		const rootMatches: FileSearchRootMatches[] = [];
		queries.forEach((queryResult, index) => {
			const root = searchableRoots[index];
			if (!root) return;
			rootMatches.push({
				rootId: root.rootId,
				rootLabel: root.label,
				matches: queryResult.data?.matches ?? [],
			});
		});

		return mergeFileSearchResults({
			rootMatches,
			limit: MERGED_RESULT_LIMIT,
		});
	}, [hasQuery, queries, searchableRoots]);

	return { results, isFetching };
}
