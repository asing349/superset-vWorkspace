import { describe, expect, it } from "bun:test";
import {
	type DiffFileChange,
	distillCapture,
	distillDiffShape,
	distillIntent,
} from "./distill";

const files: DiffFileChange[] = [
	{
		path: "packages/host-service/src/trpc/router/memory/memory.ts",
		status: "modified",
		additions: 30,
		deletions: 4,
	},
	{
		path: "packages/memory/src/distill/distill.ts",
		status: "added",
		additions: 120,
		deletions: 0,
	},
	{
		path: "apps/web/src/old.ts",
		status: "deleted",
		additions: 0,
		deletions: 12,
	},
];

describe("distillIntent", () => {
	it("prefers the PR title", () => {
		expect(
			distillIntent({ prTitle: "  Add memory capture  ", changedFiles: files }),
		).toBe("Add memory capture");
	});

	it("falls back to the body's first non-empty line", () => {
		expect(
			distillIntent({
				prTitle: "   ",
				prBody: "\n\n  Fix the flaky test  \nmore",
				changedFiles: files,
			}),
		).toBe("Fix the flaky test");
	});

	it("falls back to a path summary when title and body are empty", () => {
		expect(distillIntent({ prTitle: "", changedFiles: files })).toContain(
			"Changes across 3 files",
		);
	});

	it("never returns empty", () => {
		expect(distillIntent({ prTitle: "", changedFiles: [] })).toBe(
			"Untitled change",
		);
	});
});

describe("distillDiffShape", () => {
	it("returns null for no changes", () => {
		expect(distillDiffShape([])).toBeNull();
	});

	it("tallies by status, sums churn, and lists sorted paths — no content", () => {
		const shape = distillDiffShape(files);
		expect(shape).not.toBeNull();
		const text = shape ?? "";
		expect(text).toContain("3 files");
		expect(text).toContain("1 added");
		expect(text).toContain("1 modified");
		expect(text).toContain("1 deleted");
		// +150 added / -16 deleted across the three files.
		expect(text).toContain("+150/-16");
		// Paths are listed (sorted), but never file CONTENT.
		expect(text).toContain("apps/web/src/old.ts");
		expect(text.indexOf("apps/web")).toBeLessThan(
			text.indexOf("packages/host-service"),
		);
	});

	it("caps the path list and reports overflow", () => {
		const many: DiffFileChange[] = Array.from({ length: 20 }, (_, i) => ({
			path: `src/file-${String(i).padStart(2, "0")}.ts`,
			status: "modified" as const,
		}));
		const shape = distillDiffShape(many) ?? "";
		expect(shape).toContain("+8 more");
		expect(shape).toContain("20 files");
	});
});

describe("distillCapture", () => {
	it("produces a deterministic, model-free capture input with derived areas", () => {
		const distilled = distillCapture({
			prTitle: "Add memory capture",
			prBody: null,
			changedFiles: files,
			commands: ["bun test packages/memory"],
			validation: "memory suite green",
		});

		expect(distilled.intent).toBe("Add memory capture");
		// Touched paths are de-duped and sorted.
		expect(distilled.touchedPaths).toEqual([
			"apps/web/src/old.ts",
			"packages/host-service/src/trpc/router/memory/memory.ts",
			"packages/memory/src/distill/distill.ts",
		]);
		// Areas derived from the paths (multi-label): backend + frontend + memory.
		expect(distilled.areaTags).toContain("backend");
		expect(distilled.areaTags).toContain("frontend");
		expect(distilled.areaTags).toContain("memory");
		expect(distilled.commands).toEqual(["bun test packages/memory"]);
		expect(distilled.validation).toBe("memory suite green");
		expect(distilled.diffShape).toContain("3 files");
	});

	it("de-dupes touched paths", () => {
		const distilled = distillCapture({
			prTitle: "x",
			changedFiles: [
				{ path: "a.ts", status: "modified" },
				{ path: "a.ts", status: "modified" },
			],
		});
		expect(distilled.touchedPaths).toEqual(["a.ts"]);
	});
});
