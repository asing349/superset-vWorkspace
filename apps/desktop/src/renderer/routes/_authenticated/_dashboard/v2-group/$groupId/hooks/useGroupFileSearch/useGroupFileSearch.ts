import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

const SEARCH_LIMIT_PER_ROOT = 50;
const MERGED_RESULT_LIMIT = 50;

// TODO(group-content-search): cross-root content search (fan out
// `filesystem.searchContent` per root, merge with per-root labels) is deferred.
// The host contract is already group-addressable (`{ groupId, rootId }`), so the
// fan-out would mirror `useGroupFileSearch` exactly, but there is no existing v2
// single-workspace content-search panel/sidebar tab to mirror its UX from, so
// adding one is not "straightforward" per the task scope. The file-name
// quick-open below is the required Q4 piece; content search is the secondary
// nicety and is left for a follow-up that designs the panel UX.

/**
 * One merged, ranked file-name search result across every root of the group.
 * `rootId` is what `useGroupFileNavigation.openFilePane` needs to open the file
 * from the correct root; `rootLabel` is shown in the result row so the user can
 * tell which root a match came from when the same relative path exists in two.
 */
export interface GroupFileSearchResult {
	/** Stable, root-scoped id (`<rootId>:<absolutePath>`) — unique across roots. */
	id: string;
	name: string;
	absolutePath: string;
	relativePath: string;
	/** The root this match came from (drives `openFilePane`'s FS routing). */
	rootId: string;
	/** Display label of the owning root (per-result label, Q4). */
	rootLabel: string;
	/** Fuzzy score from the host scorer; used to interleave roots by relevance. */
	score: number;
}

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

		const merged: GroupFileSearchResult[] = [];
		const seen = new Set<string>();

		queries.forEach((queryResult, index) => {
			const root = searchableRoots[index];
			if (!root) return;
			const matches = queryResult.data?.matches ?? [];
			for (const match of matches) {
				const id = `${root.rootId}:${match.absolutePath}`;
				if (seen.has(id)) continue;
				seen.add(id);
				merged.push({
					id,
					name: match.name,
					absolutePath: match.absolutePath,
					relativePath: match.relativePath,
					rootId: root.rootId,
					rootLabel: root.label,
					score: match.score,
				});
			}
		});

		// Interleave roots by relevance: highest fuzzy score first. Ties break on
		// relativePath for a stable, deterministic order.
		merged.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.relativePath.localeCompare(b.relativePath);
		});

		return merged.slice(0, MERGED_RESULT_LIMIT);
	}, [hasQuery, queries, searchableRoots]);

	return { results, isFetching };
}
