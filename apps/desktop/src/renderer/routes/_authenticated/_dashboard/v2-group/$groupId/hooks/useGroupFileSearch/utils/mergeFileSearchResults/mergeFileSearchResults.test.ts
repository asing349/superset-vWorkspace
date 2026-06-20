import { describe, expect, test } from "bun:test";
import {
	type FileSearchRootMatches,
	mergeFileSearchResults,
} from "./mergeFileSearchResults";

/**
 * Wave-2 M9 — pure cross-root file-name search merge.
 *
 * Extracted verbatim from `useGroupFileSearch`'s former inline `useMemo` so the
 * rank/dedup/label logic is unit-testable without rendering the hook (which
 * needs `workspaceTrpc.useQueries` + the WorkspaceGroupProvider). The hook still
 * imports and calls `mergeFileSearchResults` — only the call site moved.
 *
 * Coverage: results from multiple roots merge into one list; each result carries
 * its owning root's `rootId` + `rootLabel`; ordering is score-descending with a
 * deterministic `relativePath` tiebreak; dedup is per-root (same path under two
 * roots is kept as two entries, an exact within-root repeat is dropped); the
 * merged list is capped at `limit`.
 */

function match(opts: {
	name: string;
	relativePath: string;
	score: number;
	root: string;
}): FileSearchRootMatches["matches"][number] {
	return {
		name: opts.name,
		absolutePath: `/${opts.root}/${opts.relativePath}`,
		relativePath: opts.relativePath,
		score: opts.score,
	};
}

describe("mergeFileSearchResults", () => {
	test("merges matches from multiple roots into one list", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						name: "a.ts",
						relativePath: "src/a.ts",
						score: 5,
						root: "root-a",
					}),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({
						name: "b.ts",
						relativePath: "src/b.ts",
						score: 3,
						root: "root-b",
					}),
				],
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		expect(merged).toHaveLength(2);
		expect(merged.map((r) => r.rootId).sort()).toEqual(["root-a", "root-b"]);
	});

	test("each result carries its owning root's rootId and rootLabel", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						name: "a.ts",
						relativePath: "src/a.ts",
						score: 5,
						root: "root-a",
					}),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({
						name: "b.ts",
						relativePath: "src/b.ts",
						score: 9,
						root: "root-b",
					}),
				],
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		const byRoot = new Map(merged.map((r) => [r.rootId, r]));
		expect(byRoot.get("root-a")?.rootLabel).toBe("Repo A");
		expect(byRoot.get("root-b")?.rootLabel).toBe("Repo B");
		// id is root-scoped: `<rootId>:<absolutePath>`.
		expect(byRoot.get("root-a")?.id).toBe("root-a:/root-a/src/a.ts");
	});

	test("orders by score descending (score-interleave across roots)", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						name: "low.ts",
						relativePath: "a/low.ts",
						score: 1,
						root: "root-a",
					}),
					match({
						name: "high.ts",
						relativePath: "a/high.ts",
						score: 8,
						root: "root-a",
					}),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({
						name: "mid.ts",
						relativePath: "b/mid.ts",
						score: 5,
						root: "root-b",
					}),
				],
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		// Highest score first regardless of which root it came from.
		expect(merged.map((r) => r.score)).toEqual([8, 5, 1]);
		expect(merged.map((r) => r.rootId)).toEqual(["root-a", "root-b", "root-a"]);
	});

	test("ties break deterministically on relativePath (localeCompare)", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						name: "z.ts",
						relativePath: "z.ts",
						score: 5,
						root: "root-a",
					}),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({
						name: "a.ts",
						relativePath: "a.ts",
						score: 5,
						root: "root-b",
					}),
				],
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		// Same score → "a.ts" sorts before "z.ts".
		expect(merged.map((r) => r.relativePath)).toEqual(["a.ts", "z.ts"]);
	});

	test("keeps the same relative path under two different roots as two entries", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						name: "index.ts",
						relativePath: "src/index.ts",
						score: 7,
						root: "root-a",
					}),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({
						name: "index.ts",
						relativePath: "src/index.ts",
						score: 7,
						root: "root-b",
					}),
				],
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		// Same relativePath but distinct absolutePaths/roots → two distinct results.
		expect(merged).toHaveLength(2);
		expect(merged.map((r) => r.id).sort()).toEqual([
			"root-a:/root-a/src/index.ts",
			"root-b:/root-b/src/index.ts",
		]);
	});

	test("dedupes an exact repeat within a single root by (rootId, absolutePath)", () => {
		const dup = match({
			name: "dup.ts",
			relativePath: "src/dup.ts",
			score: 4,
			root: "root-a",
		});
		const rootMatches: FileSearchRootMatches[] = [
			{ rootId: "root-a", rootLabel: "Repo A", matches: [dup, dup] },
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 50 });

		expect(merged).toHaveLength(1);
	});

	test("caps the merged list at `limit`", () => {
		const rootMatches: FileSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: Array.from({ length: 10 }, (_, i) =>
					match({
						name: `f${i}.ts`,
						relativePath: `src/f${i}.ts`,
						score: 10 - i,
						root: "root-a",
					}),
				),
			},
		];

		const merged = mergeFileSearchResults({ rootMatches, limit: 3 });

		expect(merged).toHaveLength(3);
		// The cap is applied AFTER sorting, so the top-3 by score survive.
		expect(merged.map((r) => r.score)).toEqual([10, 9, 8]);
	});

	test("returns an empty list when there are no matches", () => {
		expect(mergeFileSearchResults({ rootMatches: [], limit: 50 })).toEqual([]);
		expect(
			mergeFileSearchResults({
				rootMatches: [{ rootId: "root-a", rootLabel: "Repo A", matches: [] }],
				limit: 50,
			}),
		).toEqual([]);
	});
});
