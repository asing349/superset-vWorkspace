import { describe, expect, test } from "bun:test";
import { mergeChangedFiles } from "./mergeChangedFiles";

type GitStatusData = Parameters<typeof mergeChangedFiles>[0];

function makeStatus(
	overrides: Partial<NonNullable<GitStatusData>>,
): NonNullable<GitStatusData> {
	return {
		currentBranch: {
			name: "feature",
			isHead: true,
			upstream: null,
			aheadCount: 0,
			behindCount: 0,
			lastCommitHash: "abc",
			lastCommitDate: "2026-06-19",
		},
		againstBase: [],
		staged: [],
		unstaged: [],
		...overrides,
	} as NonNullable<GitStatusData>;
}

function file(path: string, status: string) {
	return {
		path,
		status,
		additions: 0,
		deletions: 0,
	} as NonNullable<GitStatusData>["againstBase"][number];
}

describe("mergeChangedFiles", () => {
	test("returns an empty list when status is undefined", () => {
		expect(mergeChangedFiles(undefined)).toEqual([]);
	});

	test("dedupes a path across buckets and keeps the highest severity", () => {
		const status = makeStatus({
			staged: [file("src/a.ts", "added")],
			unstaged: [file("src/a.ts", "deleted")],
		});
		const merged = mergeChangedFiles(status);
		expect(merged).toEqual([{ path: "src/a.ts", status: "deleted" }]);
	});

	test("merges across all three buckets and sorts by path", () => {
		const status = makeStatus({
			againstBase: [file("z.ts", "modified")],
			staged: [file("a.ts", "added")],
			unstaged: [file("m.ts", "untracked")],
		});
		const merged = mergeChangedFiles(status);
		expect(merged.map((f) => f.path)).toEqual(["a.ts", "m.ts", "z.ts"]);
		expect(merged.find((f) => f.path === "z.ts")?.status).toBe("modified");
	});
});
