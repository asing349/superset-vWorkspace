/**
 * Wave 6, M2 PR-list filters for the picker. These literals are the contract
 * with the Electron-main `projects.listFilteredPullRequests` input enum; the
 * server maps each to its GitHub search qualifier(s).
 */
export type PrListFilter = "all" | "created" | "review-requested";

export const PR_FILTER_OPTIONS: ReadonlyArray<{
	value: PrListFilter;
	label: string;
}> = [
	{ value: "all", label: "All" },
	{ value: "created", label: "Created by me" },
	{ value: "review-requested", label: "Review-requested · Tagged" },
];
