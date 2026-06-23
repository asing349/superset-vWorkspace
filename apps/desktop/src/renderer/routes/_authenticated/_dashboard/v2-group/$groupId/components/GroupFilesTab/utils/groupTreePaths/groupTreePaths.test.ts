import { describe, expect, it } from "bun:test";
import {
	getNameFromPath,
	getParentDirectory,
	isValidEntryName,
	joinPath,
	normalizeAbsolutePath,
	pickDefaultEntryName,
} from "./groupTreePaths";

describe("normalizeAbsolutePath", () => {
	it("converts backslashes and strips trailing slashes", () => {
		expect(normalizeAbsolutePath("/a/b/")).toBe("/a/b");
		expect(normalizeAbsolutePath("\\a\\b\\")).toBe("/a/b");
	});

	it("keeps a bare root", () => {
		expect(normalizeAbsolutePath("/")).toBe("/");
		expect(normalizeAbsolutePath("")).toBe("/");
	});
});

describe("getParentDirectory", () => {
	it("returns the parent of a nested path", () => {
		expect(getParentDirectory("/a/b/c.txt")).toBe("/a/b");
		expect(getParentDirectory("/a/b/")).toBe("/a");
	});

	it("returns the root itself when there is no parent", () => {
		expect(getParentDirectory("/a")).toBe("/");
		expect(getParentDirectory("/")).toBe("/");
	});
});

describe("joinPath", () => {
	it("joins a directory and a name", () => {
		expect(joinPath("/a/b", "c.txt")).toBe("/a/b/c.txt");
		expect(joinPath("/a/b/", "/c.txt/")).toBe("/a/b/c.txt");
	});

	it("handles the filesystem root", () => {
		expect(joinPath("/", "c.txt")).toBe("/c.txt");
	});
});

describe("getNameFromPath", () => {
	it("returns the final segment", () => {
		expect(getNameFromPath("/a/b/c.txt")).toBe("c.txt");
		expect(getNameFromPath("/a/b/")).toBe("b");
	});
});

describe("isValidEntryName", () => {
	it("accepts simple names", () => {
		expect(isValidEntryName("file.ts")).toBe(true);
		expect(isValidEntryName("  spaced  ")).toBe(true);
	});

	it("rejects empty, dotted, and separator-containing names", () => {
		expect(isValidEntryName("")).toBe(false);
		expect(isValidEntryName("   ")).toBe(false);
		expect(isValidEntryName(".")).toBe(false);
		expect(isValidEntryName("..")).toBe(false);
		expect(isValidEntryName("a/b")).toBe(false);
		expect(isValidEntryName("a\\b")).toBe(false);
	});
});

describe("pickDefaultEntryName", () => {
	it("uses the base name when nothing collides", () => {
		expect(pickDefaultEntryName({ mode: "file", existingNames: [] })).toBe(
			"untitled",
		);
		expect(pickDefaultEntryName({ mode: "folder", existingNames: [] })).toBe(
			"Untitled",
		);
	});

	it("appends a numeric suffix on collisions", () => {
		expect(
			pickDefaultEntryName({
				mode: "file",
				existingNames: ["untitled", "untitled-2"],
			}),
		).toBe("untitled-3");
	});
});
