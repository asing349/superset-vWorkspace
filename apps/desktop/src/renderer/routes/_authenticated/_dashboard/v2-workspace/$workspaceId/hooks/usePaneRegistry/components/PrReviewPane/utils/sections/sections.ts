/**
 * The PR-review window's tabs (segmented control). Data-driven, mirroring the
 * Memory panel's `MEMORY_SECTIONS` precedent so the header stays a thin renderer
 * over this list:
 *   - "diff"     — the PR's code changes (wave 5, fed by `prReview.getDiff`).
 *   - "findings" — the wave-6 grounded review findings (empty state until the
 *     button-only `prReview.reviewPr` runs; anchors jump back to the Diff tab).
 *   - "guide"    — the memory-grounded review guide (wave 5).
 */

export type PrReviewSection = "diff" | "findings" | "guide";

export interface PrReviewSectionDef {
	id: PrReviewSection;
	label: string;
}

export const PR_REVIEW_SECTIONS: readonly PrReviewSectionDef[] = [
	{ id: "diff", label: "Diff" },
	{ id: "findings", label: "Findings" },
	{ id: "guide", label: "Guide" },
];

/** The default tab a freshly-opened window lands on. */
export const DEFAULT_PR_REVIEW_SECTION: PrReviewSection = "diff";

/** Whether a section id is one of the window's tabs. */
export function isPrReviewSection(section: string): section is PrReviewSection {
	return PR_REVIEW_SECTIONS.some((s) => s.id === section);
}

/**
 * Resolve a (possibly stale/persisted) section id to a valid tab, falling back
 * to the default when the stored value isn't one of the tabs.
 */
export function resolvePrReviewSection(
	section: string | null | undefined,
): PrReviewSection {
	if (section && isPrReviewSection(section)) return section;
	return DEFAULT_PR_REVIEW_SECTION;
}
