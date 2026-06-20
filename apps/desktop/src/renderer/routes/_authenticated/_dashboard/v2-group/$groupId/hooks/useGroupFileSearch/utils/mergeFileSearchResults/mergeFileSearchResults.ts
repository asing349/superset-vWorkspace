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

/** A single host `searchFiles` match (the subset the merge reads). */
export interface FileSearchMatch {
	name: string;
	absolutePath: string;
	relativePath: string;
	score: number;
}

/** Per-root matches: the owning root's identity/label plus its host matches. */
export interface FileSearchRootMatches {
	rootId: string;
	rootLabel: string;
	matches: FileSearchMatch[];
}

/**
 * Merge per-root file-name matches into one ranked, deduped, labeled list.
 *
 * Behavior (extracted verbatim from `useGroupFileSearch`'s former inline merge,
 * unit-tested separately so the rank/dedup/label logic doesn't require rendering
 * the hook):
 *  - Each match is stamped with its owning root's `rootId` + `rootLabel`.
 *  - De-duplicated by `(rootId, absolutePath)` — the same relative path under two
 *    different roots is intentionally KEPT as two distinct entries (they open as
 *    distinct panes); only an exact repeat within one root is dropped.
 *  - Interleaved by the host's fuzzy `score` (descending) so the most relevant
 *    match wins regardless of which root it lives in; ties break on
 *    `relativePath` (`localeCompare`) for a stable, deterministic order.
 *  - Capped at `limit` results.
 */
export function mergeFileSearchResults({
	rootMatches,
	limit,
}: {
	rootMatches: FileSearchRootMatches[];
	limit: number;
}): GroupFileSearchResult[] {
	const merged: GroupFileSearchResult[] = [];
	const seen = new Set<string>();

	for (const root of rootMatches) {
		for (const match of root.matches) {
			const id = `${root.rootId}:${match.absolutePath}`;
			if (seen.has(id)) continue;
			seen.add(id);
			merged.push({
				id,
				name: match.name,
				absolutePath: match.absolutePath,
				relativePath: match.relativePath,
				rootId: root.rootId,
				rootLabel: root.rootLabel,
				score: match.score,
			});
		}
	}

	// Interleave roots by relevance: highest fuzzy score first. Ties break on
	// relativePath for a stable, deterministic order.
	merged.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.relativePath.localeCompare(b.relativePath);
	});

	return merged.slice(0, limit);
}
