import { describe, expect, it } from "bun:test";
import {
	buildPrDiffItems,
	type PrDiffFileInput,
	prDiffItemId,
} from "./buildPrDiffItems";

const PATCH = `@@ -1,3 +1,4 @@
 line one
-line two
+line two changed
+line two and a half
 line three`;

describe("buildPrDiffItems", () => {
	it("parses a raw (hunks-only) GitHub patch into a renderable diff item WITH hunks", () => {
		const files: PrDiffFileInput[] = [
			{
				filename: "src/foo.ts",
				status: "modified",
				patch: PATCH,
				additions: 2,
				deletions: 1,
			},
		];
		const results = buildPrDiffItems(42, files);
		expect(results).toHaveLength(1);
		const [result] = results;
		expect(result?.item).not.toBeNull();
		expect(result?.item?.type).toBe("diff");
		expect(result?.itemId).toBe("pr-diff:42:src/foo.ts");
		// Regression guard: a bare hunks-only patch fed WITHOUT a synthesized
		// `diff --git` header parses to ZERO hunks (renders nothing). Assert the
		// synthesized header produced a real, named, hunk-bearing diff.
		if (result?.item?.type === "diff") {
			expect(result.item.fileDiff.name).toBe("src/foo.ts");
			expect(result.item.fileDiff.hunks.length).toBeGreaterThan(0);
		}
	});

	it("yields a null item (no preview) for a file with a null patch", () => {
		const files: PrDiffFileInput[] = [
			{
				filename: "assets/logo.png",
				status: "added",
				patch: null,
				additions: 0,
				deletions: 0,
			},
		];
		const [result] = buildPrDiffItems(1, files);
		expect(result?.item).toBeNull();
		expect(result?.file.filename).toBe("assets/logo.png");
	});

	it("uses previousFilename as the old-side name on a rename", () => {
		const files: PrDiffFileInput[] = [
			{
				filename: "src/new.ts",
				previousFilename: "src/old.ts",
				status: "renamed",
				patch: PATCH,
				additions: 2,
				deletions: 1,
			},
		];
		const [result] = buildPrDiffItems(7, files);
		expect(result?.item?.type).toBe("diff");
		// The new-side filename drives the header; the synthesized `diff --git`
		// header uses previousFilename for the old side so renames render.
		if (result?.item?.type === "diff") {
			expect(result.item.fileDiff.name).toBe("src/new.ts");
			expect(result.item.fileDiff.hunks.length).toBeGreaterThan(0);
		}
	});

	it("renders an added file (no old side) with hunks", () => {
		const [result] = buildPrDiffItems(3, [
			{
				filename: "src/added.ts",
				status: "added",
				patch: "@@ -0,0 +1,2 @@\n+hello\n+world",
				additions: 2,
				deletions: 0,
			},
		]);
		expect(result?.item?.type).toBe("diff");
		if (result?.item?.type === "diff") {
			expect(result.item.fileDiff.name).toBe("src/added.ts");
			expect(result.item.fileDiff.hunks.length).toBeGreaterThan(0);
		}
	});

	it("produces stable, PR+filename-keyed item ids", () => {
		expect(prDiffItemId(12, "a/b.ts")).toBe("pr-diff:12:a/b.ts");
		const a = buildPrDiffItems(12, [
			{
				filename: "a.ts",
				status: "modified",
				patch: PATCH,
				additions: 1,
				deletions: 1,
			},
		]);
		const b = buildPrDiffItems(12, [
			{
				filename: "a.ts",
				status: "modified",
				patch: PATCH,
				additions: 1,
				deletions: 1,
			},
		]);
		expect(a[0]?.item?.version).toBe(b[0]?.item?.version);
	});

	it("changes the version when the patch changes", () => {
		const base = buildPrDiffItems(1, [
			{
				filename: "a.ts",
				status: "modified",
				patch: PATCH,
				additions: 1,
				deletions: 1,
			},
		]);
		const changed = buildPrDiffItems(1, [
			{
				filename: "a.ts",
				status: "modified",
				patch: `${PATCH}\n+one more`,
				additions: 2,
				deletions: 1,
			},
		]);
		expect(base[0]?.item?.version).not.toBe(changed[0]?.item?.version);
	});

	it("handles an empty file list", () => {
		expect(buildPrDiffItems(1, [])).toEqual([]);
	});
});
