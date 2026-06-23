import { describe, expect, it } from "bun:test";
import { computeLineDiff } from "./diff";

describe("computeLineDiff", () => {
	it("marks all lines equal for identical input", () => {
		const diff = computeLineDiff({ before: "a\nb\nc\n", after: "a\nb\nc\n" });
		expect(diff.added).toBe(0);
		expect(diff.removed).toBe(0);
		expect(diff.lines.every((l) => l.op === "equal")).toBe(true);
	});

	it("detects an added line", () => {
		const diff = computeLineDiff({ before: "a\nc", after: "a\nb\nc" });
		expect(diff.added).toBe(1);
		expect(diff.removed).toBe(0);
		expect(diff.lines.find((l) => l.op === "add")?.text).toBe("b");
	});

	it("detects a removed line", () => {
		const diff = computeLineDiff({ before: "a\nb\nc", after: "a\nc" });
		expect(diff.removed).toBe(1);
		expect(diff.added).toBe(0);
		expect(diff.lines.find((l) => l.op === "remove")?.text).toBe("b");
	});

	it("handles full replacement", () => {
		const diff = computeLineDiff({ before: "old", after: "new" });
		expect(diff.added).toBe(1);
		expect(diff.removed).toBe(1);
	});

	it("treats empty before as all-added", () => {
		const diff = computeLineDiff({ before: "", after: "x\ny" });
		expect(diff.added).toBe(2);
		expect(diff.removed).toBe(0);
	});

	it("ignores a single trailing newline (no phantom empty line)", () => {
		const diff = computeLineDiff({ before: "a\n", after: "a" });
		expect(diff.added).toBe(0);
		expect(diff.removed).toBe(0);
	});
});
