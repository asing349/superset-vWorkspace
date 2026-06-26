import { describe, expect, it } from "bun:test";
import {
	DEFAULT_PR_REVIEW_SECTION,
	isPrReviewSection,
	PR_REVIEW_SECTIONS,
	resolvePrReviewSection,
} from "./sections";

describe("PR review sections", () => {
	it("exposes the Diff, Findings and Guide tabs in order", () => {
		expect(PR_REVIEW_SECTIONS.map((s) => s.id)).toEqual([
			"diff",
			"findings",
			"guide",
		]);
	});

	it("defaults to the diff tab", () => {
		expect(DEFAULT_PR_REVIEW_SECTION).toBe("diff");
	});

	it("recognizes valid section ids", () => {
		expect(isPrReviewSection("diff")).toBe(true);
		expect(isPrReviewSection("findings")).toBe(true);
		expect(isPrReviewSection("guide")).toBe(true);
		expect(isPrReviewSection("settings")).toBe(false);
		expect(isPrReviewSection("")).toBe(false);
	});

	it("resolves a valid section to itself", () => {
		expect(resolvePrReviewSection("guide")).toBe("guide");
		expect(resolvePrReviewSection("findings")).toBe("findings");
		expect(resolvePrReviewSection("diff")).toBe("diff");
	});

	it("falls back to the default for stale/unknown/empty values", () => {
		expect(resolvePrReviewSection(undefined)).toBe("diff");
		expect(resolvePrReviewSection(null)).toBe("diff");
		expect(resolvePrReviewSection("bogus")).toBe("diff");
	});
});
