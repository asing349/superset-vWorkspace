/**
 * The PR-review window's two tabs (segmented control). Data-driven, mirroring
 * the Memory panel's `MEMORY_SECTIONS` precedent so the header stays a thin
 * renderer over this list:
 *   - "diff"  — the PR's code changes (M2, fed by `prReview.getDiff`).
 *   - "guide" — the memory-grounded review guide (empty state in M2; M4 wires
 *     the generator, M5 the anchors).
 */

export type PrReviewSection = "diff" | "guide";

export interface PrReviewSectionDef {
	id: PrReviewSection;
	label: string;
}

export const PR_REVIEW_SECTIONS: readonly PrReviewSectionDef[] = [
	{ id: "diff", label: "Diff" },
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
