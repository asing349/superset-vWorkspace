import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

const SEARCH_LIMIT_PER_ROOT = 50;
const MERGED_RESULT_LIMIT = 200;

/**
 * One merged content-search match across every root of the group (Q4 / M8).
 *
 * Mirrors `GroupFileSearchResult`, but for file *contents*: the host
 * `filesystem.searchContent` returns a flat list of LINE matches (file +
 * line/column + the matched line preview), so each result here is a single
 * matched line, not a file. `rootId` is what `useGroupFileNavigation.openFilePane`
 * needs to open the file from the correct root; `rootLabel` labels the row so the
 * user can tell which root a match came from.
 */
export interface GroupContentSearchResult {
	/** Stable, root-scoped id (`<rootId>:<absolutePath>:<line>:<column>`). */
	id: string;
	name: string;
	absolutePath: string;
	relativePath: string;
	/** 1-based line number of the match within the file. */
	line: number;
	/** 1-based column of the match within the line. */
	column: number;
	/** The matched line's text (host-provided preview/snippet). */
	preview: string;
	/** The root this match came from (drives `openFilePane`'s FS routing). */
	rootId: string;
	/** Display label of the owning root (per-result label, Q4). */
	rootLabel: string;
}

/** A group of content matches that all live in the same file of the same root. */
export interface GroupContentSearchFileGroup {
	/** Stable id for the file group (`<rootId>:<absolutePath>`). */
	id: string;
	name: string;
	absolutePath: string;
	relativePath: string;
	rootId: string;
	rootLabel: string;
	matches: GroupContentSearchResult[];
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const segments = normalized.split(/[\\/]/);
	return segments[segments.length - 1] ?? normalized;
}

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

		// One ordered list of file-groups per root, so we can interleave roots
		// round-robin. Within a root, file-groups appear in first-seen order; within
		// a file, matches keep host (line) order.
		const perRootGroups: GroupContentSearchFileGroup[][] = [];
		const seenMatch = new Set<string>();
		let total = 0;

		queries.forEach((queryResult, index) => {
			const root = searchableRoots[index];
			if (!root) return;
			const matches = queryResult.data?.matches ?? [];

			const groupsForRoot: GroupContentSearchFileGroup[] = [];
			const groupByPath = new Map<string, GroupContentSearchFileGroup>();

			for (const match of matches) {
				const matchId = `${root.rootId}:${match.absolutePath}:${match.line}:${match.column}`;
				if (seenMatch.has(matchId)) continue;
				seenMatch.add(matchId);

				const result: GroupContentSearchResult = {
					id: matchId,
					name: basename(match.absolutePath),
					absolutePath: match.absolutePath,
					relativePath: match.relativePath,
					line: match.line,
					column: match.column,
					preview: match.preview,
					rootId: root.rootId,
					rootLabel: root.label,
				};
				total += 1;

				const fileGroupId = `${root.rootId}:${match.absolutePath}`;
				let fileGroup = groupByPath.get(fileGroupId);
				if (!fileGroup) {
					fileGroup = {
						id: fileGroupId,
						name: result.name,
						absolutePath: match.absolutePath,
						relativePath: match.relativePath,
						rootId: root.rootId,
						rootLabel: root.label,
						matches: [],
					};
					groupByPath.set(fileGroupId, fileGroup);
					groupsForRoot.push(fileGroup);
				}
				fileGroup.matches.push(result);
			}

			if (groupsForRoot.length > 0) perRootGroups.push(groupsForRoot);
		});

		// Interleave roots round-robin: take the i-th file group from each root in
		// turn, so the panel shows breadth across roots before depth within one.
		const interleaved: GroupContentSearchFileGroup[] = [];
		const maxGroups = perRootGroups.reduce(
			(max, group) => Math.max(max, group.length),
			0,
		);
		for (let i = 0; i < maxGroups; i += 1) {
			for (const rootGroups of perRootGroups) {
				const group = rootGroups[i];
				if (group) interleaved.push(group);
			}
		}

		// Cap total rendered matches (file headers + lines) for performance on a
		// large repo, keeping whole file groups intact.
		const capped: GroupContentSearchFileGroup[] = [];
		let rendered = 0;
		for (const group of interleaved) {
			if (rendered >= MERGED_RESULT_LIMIT) break;
			capped.push(group);
			rendered += group.matches.length;
		}

		return { fileGroups: capped, totalMatches: total };
	}, [hasQuery, queries, searchableRoots]);

	return { fileGroups, totalMatches, isFetching };
}
