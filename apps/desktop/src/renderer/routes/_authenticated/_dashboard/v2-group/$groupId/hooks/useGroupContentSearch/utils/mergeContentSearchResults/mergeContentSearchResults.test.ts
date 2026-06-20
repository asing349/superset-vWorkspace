import { describe, expect, test } from "bun:test";
import {
	type ContentSearchRootMatches,
	mergeContentSearchResults,
} from "./mergeContentSearchResults";

/**
 * Wave-2 M9 — pure cross-root content (M8) search merge.
 *
 * Extracted verbatim from `useGroupContentSearch`'s former inline `useMemo` so
 * the group/dedup/round-robin-interleave/label logic is unit-testable without
 * rendering the hook. The hook still imports and calls
 * `mergeContentSearchResults` — only the call site moved.
 *
 * Coverage: matches from multiple roots merge; matches in the same file group
 * under one root header (host line order preserved); each group/result carries
 * its owning root's `rootId` + `rootLabel`; ROOTS interleave round-robin (one
 * file group per root in turn, breadth before depth); dedup by
 * `(rootId, absolutePath, line, column)`; `totalMatches` is the un-capped count
 * and the returned groups are capped by RENDERED matches keeping groups intact.
 */

function match(opts: {
	root: string;
	relativePath: string;
	line: number;
	column?: number;
	preview?: string;
}): ContentSearchRootMatches["matches"][number] {
	return {
		absolutePath: `/${opts.root}/${opts.relativePath}`,
		relativePath: opts.relativePath,
		line: opts.line,
		column: opts.column ?? 1,
		preview: opts.preview ?? `line ${opts.line}`,
	};
}

describe("mergeContentSearchResults", () => {
	test("merges matches from multiple roots and labels each group by its root", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [match({ root: "root-a", relativePath: "src/a.ts", line: 1 })],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [match({ root: "root-b", relativePath: "src/b.ts", line: 2 })],
			},
		];

		const { fileGroups, totalMatches } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		expect(totalMatches).toBe(2);
		expect(fileGroups).toHaveLength(2);
		const byRoot = new Map(fileGroups.map((g) => [g.rootId, g]));
		expect(byRoot.get("root-a")?.rootLabel).toBe("Repo A");
		expect(byRoot.get("root-b")?.rootLabel).toBe("Repo B");
		// File-group id is `<rootId>:<absolutePath>`.
		expect(byRoot.get("root-a")?.id).toBe("root-a:/root-a/src/a.ts");
	});

	test("groups multiple line matches in the same file, preserving host line order", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({ root: "root-a", relativePath: "src/a.ts", line: 10 }),
					match({ root: "root-a", relativePath: "src/a.ts", line: 3 }),
					match({ root: "root-a", relativePath: "src/a.ts", line: 42 }),
				],
			},
		];

		const { fileGroups, totalMatches } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		expect(totalMatches).toBe(3);
		expect(fileGroups).toHaveLength(1);
		// Matches keep first-seen (host) order — NOT re-sorted by line number.
		expect(fileGroups[0]?.matches.map((m) => m.line)).toEqual([10, 3, 42]);
		// Each match carries the root label too.
		expect(fileGroups[0]?.matches.every((m) => m.rootLabel === "Repo A")).toBe(
			true,
		);
	});

	test("interleaves ROOTS round-robin: one file group per root in turn", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({ root: "root-a", relativePath: "a1.ts", line: 1 }),
					match({ root: "root-a", relativePath: "a2.ts", line: 1 }),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({ root: "root-b", relativePath: "b1.ts", line: 1 }),
					match({ root: "root-b", relativePath: "b2.ts", line: 1 }),
				],
			},
		];

		const { fileGroups } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		// Breadth before depth: a1, b1, a2, b2 — NOT a1, a2, b1, b2.
		expect(fileGroups.map((g) => g.relativePath)).toEqual([
			"a1.ts",
			"b1.ts",
			"a2.ts",
			"b2.ts",
		]);
	});

	test("round-robin handles uneven roots (one root has more file groups)", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({ root: "root-a", relativePath: "a1.ts", line: 1 }),
					match({ root: "root-a", relativePath: "a2.ts", line: 1 }),
					match({ root: "root-a", relativePath: "a3.ts", line: 1 }),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [match({ root: "root-b", relativePath: "b1.ts", line: 1 })],
			},
		];

		const { fileGroups } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		// a1, b1, then a2, a3 (root-b exhausted — its slots are skipped).
		expect(fileGroups.map((g) => g.relativePath)).toEqual([
			"a1.ts",
			"b1.ts",
			"a2.ts",
			"a3.ts",
		]);
	});

	test("dedupes by (rootId, absolutePath, line, column)", () => {
		const dup = match({
			root: "root-a",
			relativePath: "src/a.ts",
			line: 5,
			column: 2,
		});
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					dup,
					dup,
					// Same file+line but different column → NOT a dup.
					match({
						root: "root-a",
						relativePath: "src/a.ts",
						line: 5,
						column: 9,
					}),
				],
			},
		];

		const { fileGroups, totalMatches } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		expect(totalMatches).toBe(2);
		expect(fileGroups).toHaveLength(1);
		expect(fileGroups[0]?.matches.map((m) => m.column)).toEqual([2, 9]);
	});

	test("same relative path under two roots stays in two distinct groups", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({ root: "root-a", relativePath: "src/shared.ts", line: 1 }),
				],
			},
			{
				rootId: "root-b",
				rootLabel: "Repo B",
				matches: [
					match({ root: "root-b", relativePath: "src/shared.ts", line: 1 }),
				],
			},
		];

		const { fileGroups } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		expect(fileGroups).toHaveLength(2);
		expect(fileGroups.map((g) => g.id).sort()).toEqual([
			"root-a:/root-a/src/shared.ts",
			"root-b:/root-b/src/shared.ts",
		]);
	});

	test("caps by RENDERED match count while keeping whole groups, but reports the un-capped total", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					// File group with 2 matches.
					match({ root: "root-a", relativePath: "a.ts", line: 1 }),
					match({ root: "root-a", relativePath: "a.ts", line: 2 }),
					// Another file group with 2 matches.
					match({ root: "root-a", relativePath: "b.ts", line: 1 }),
					match({ root: "root-a", relativePath: "b.ts", line: 2 }),
				],
			},
		];

		// Limit 3: first group (2 matches) fits, rendered=2 < 3, so the second
		// group is added WHOLE (rendered becomes 4); a third would be cut.
		const { fileGroups, totalMatches } = mergeContentSearchResults({
			rootMatches,
			limit: 3,
		});

		expect(totalMatches).toBe(4);
		expect(fileGroups).toHaveLength(2);
		// Groups are kept intact — the cap never splits a file group.
		expect(fileGroups[0]?.matches).toHaveLength(2);
		expect(fileGroups[1]?.matches).toHaveLength(2);
	});

	test("returns empty groups and zero total when there are no matches", () => {
		expect(mergeContentSearchResults({ rootMatches: [], limit: 200 })).toEqual({
			fileGroups: [],
			totalMatches: 0,
		});
	});

	test("derives the file name from the absolute path basename", () => {
		const rootMatches: ContentSearchRootMatches[] = [
			{
				rootId: "root-a",
				rootLabel: "Repo A",
				matches: [
					match({
						root: "root-a",
						relativePath: "deep/nested/file.ts",
						line: 1,
					}),
				],
			},
		];

		const { fileGroups } = mergeContentSearchResults({
			rootMatches,
			limit: 200,
		});

		expect(fileGroups[0]?.name).toBe("file.ts");
		expect(fileGroups[0]?.matches[0]?.name).toBe("file.ts");
	});
});
