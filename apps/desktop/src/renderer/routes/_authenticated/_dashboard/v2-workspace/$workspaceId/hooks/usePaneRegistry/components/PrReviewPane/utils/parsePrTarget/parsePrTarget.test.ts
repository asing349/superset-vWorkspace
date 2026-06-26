import { describe, expect, it } from "bun:test";
import { parsePrTarget } from "./parsePrTarget";

/**
 * Wave-6 M3: the PR-URL → `{ owner, repo }` parser that feeds the "Post comment"
 * action's `github.createReviewComment` call. Pure browser-safe logic.
 */
describe("parsePrTarget", () => {
	it("extracts owner + repo from a standard PR url", () => {
		expect(parsePrTarget("https://github.com/acme/widget/pull/42")).toEqual({
			owner: "acme",
			repo: "widget",
		});
	});

	it("handles a trailing path segment (e.g. /files)", () => {
		expect(
			parsePrTarget("https://github.com/acme/widget/pull/42/files"),
		).toEqual({ owner: "acme", repo: "widget" });
	});

	it("handles hyphenated / dotted owner and repo names", () => {
		expect(parsePrTarget("https://github.com/my-org/my.repo/pull/1")).toEqual({
			owner: "my-org",
			repo: "my.repo",
		});
	});

	it("returns null for a null / undefined / empty url", () => {
		expect(parsePrTarget(null)).toBeNull();
		expect(parsePrTarget(undefined)).toBeNull();
		expect(parsePrTarget("")).toBeNull();
	});

	it("returns null for a non-PR github url", () => {
		expect(parsePrTarget("https://github.com/acme/widget")).toBeNull();
		expect(
			parsePrTarget("https://github.com/acme/widget/issues/42"),
		).toBeNull();
	});

	it("returns null for a non-github url", () => {
		expect(parsePrTarget("https://example.com/acme/widget/pull/42")).toBeNull();
	});
});
