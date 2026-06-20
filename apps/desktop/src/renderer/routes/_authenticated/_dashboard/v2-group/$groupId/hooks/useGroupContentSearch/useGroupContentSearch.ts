import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";
import {
	type ContentSearchRootMatches,
	type GroupContentSearchFileGroup,
	mergeContentSearchResults,
} from "./utils/mergeContentSearchResults";

export type {
	GroupContentSearchFileGroup,
	GroupContentSearchResult,
} from "./utils/mergeContentSearchResults";

const SEARCH_LIMIT_PER_ROOT = 50;
const MERGED_RESULT_LIMIT = 200;

/**
 * Cross-root content search (Q4 fan-out-and-merge, M8).
 *
 * Fans out one `filesystem.searchContent({ groupId, rootId, query })` call per
 * resolved root that currently exists on disk (roots with `exists: false` are
 * skipped — their FS service can't be created), runs them in PARALLEL over the
 * single per-host connection via `workspaceTrpc.useQueries` (exactly like
 * `useGroupFileSearch` does for `searchFiles`), then merges every root's matches.
 *
 * Ranking/dedup: content matches carry no fuzzy `score` (unlike `searchFiles`),
 * so we cannot interleave by relevance. Instead we **group by root** then by file
 * within each root, and interleave the ROOTS round-robin (one file group from each
 * root in turn) so a single large repo can't drown out the others. Within a file,
 * matches keep host (line) order. Results are de-duplicated by
 * `(rootId, absolutePath, line, column)`.
 *
 * The per-root query is disabled until there's a query string, so an idle
 * overlay issues no host calls.
 */
export function useGroupContentSearch(query: string): {
	fileGroups: GroupContentSearchFileGroup[];
	totalMatches: number;
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
			t.filesystem.searchContent(
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

	const { fileGroups, totalMatches } = useMemo<{
		fileGroups: GroupContentSearchFileGroup[];
		totalMatches: number;
	}>(() => {
		if (!hasQuery) return { fileGroups: [], totalMatches: 0 };

		const rootMatches: ContentSearchRootMatches[] = [];
		queries.forEach((queryResult, index) => {
			const root = searchableRoots[index];
			if (!root) return;
			rootMatches.push({
				rootId: root.rootId,
				rootLabel: root.label,
				matches: queryResult.data?.matches ?? [],
			});
		});

		return mergeContentSearchResults({
			rootMatches,
			limit: MERGED_RESULT_LIMIT,
		});
	}, [hasQuery, queries, searchableRoots]);

	return { fileGroups, totalMatches, isFetching };
}
