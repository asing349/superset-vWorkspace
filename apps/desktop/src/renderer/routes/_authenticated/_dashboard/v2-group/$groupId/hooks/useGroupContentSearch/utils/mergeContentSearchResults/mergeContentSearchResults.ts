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

/** A single host `searchContent` match (the subset the merge reads). */
export interface ContentSearchMatch {
	absolutePath: string;
	relativePath: string;
	line: number;
	column: number;
	preview: string;
}

/** Per-root matches: the owning root's identity/label plus its host matches. */
export interface ContentSearchRootMatches {
	rootId: string;
	rootLabel: string;
	matches: ContentSearchMatch[];
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const segments = normalized.split(/[\\/]/);
	return segments[segments.length - 1] ?? normalized;
}

/**
 * Merge per-root content matches into one interleaved, deduped, grouped, labeled
 * list of file-groups (plus the total un-capped match count).
 *
 * Behavior (extracted verbatim from `useGroupContentSearch`'s former inline
 * merge, unit-tested separately so the round-robin/dedup/group logic doesn't
 * require rendering the hook):
 *  - Each match is stamped with its owning root's `rootId` + `rootLabel` and
 *    grouped by file (`(rootId, absolutePath)`); within a file, matches keep host
 *    (line) order.
 *  - De-duplicated by `(rootId, absolutePath, line, column)`.
 *  - ROOTS are interleaved round-robin: the i-th file group from each root in
 *    turn, so the panel shows breadth across roots before depth within one (a
 *    single large repo can't drown out the others). Content matches carry no
 *    fuzzy `score`, so relevance interleave isn't possible.
 *  - Capped at `limit` RENDERED matches (file headers + lines), keeping whole
 *    file groups intact. `totalMatches` is the un-capped count.
 */
export function mergeContentSearchResults({
	rootMatches,
	limit,
}: {
	rootMatches: ContentSearchRootMatches[];
	limit: number;
}): {
	fileGroups: GroupContentSearchFileGroup[];
	totalMatches: number;
} {
	// One ordered list of file-groups per root, so we can interleave roots
	// round-robin. Within a root, file-groups appear in first-seen order; within
	// a file, matches keep host (line) order.
	const perRootGroups: GroupContentSearchFileGroup[][] = [];
	const seenMatch = new Set<string>();
	let total = 0;

	for (const root of rootMatches) {
		const groupsForRoot: GroupContentSearchFileGroup[] = [];
		const groupByPath = new Map<string, GroupContentSearchFileGroup>();

		for (const match of root.matches) {
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
				rootLabel: root.rootLabel,
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
					rootLabel: root.rootLabel,
					matches: [],
				};
				groupByPath.set(fileGroupId, fileGroup);
				groupsForRoot.push(fileGroup);
			}
			fileGroup.matches.push(result);
		}

		if (groupsForRoot.length > 0) perRootGroups.push(groupsForRoot);
	}

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
		if (rendered >= limit) break;
		capped.push(group);
		rendered += group.matches.length;
	}

	return { fileGroups: capped, totalMatches: total };
}
