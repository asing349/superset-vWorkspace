/**
 * PR-list filter helpers (Wave 6, M2) — pure, no Electron/Node imports so they
 * are unit-testable and shareable.
 *
 * The PR picker (`PullRequestsSubmenu`) offers three read-only views of a repo's
 * pull requests, all served by the existing `gh pr list [--search]` path:
 *
 * - `all`            — every PR (no search qualifier).
 * - `created`        — PRs you opened (`author:@me`).
 * - `review-requested` — PRs you're tagged in: the UNION of `review-requested:@me`,
 *   `assignee:@me`, and `mentions:@me`.
 *
 * `@me` is resolved server-side by GitHub to the `gh`-authenticated account (the
 * same identity `getGitHubUsername` reads via `gh api user`), so no client-side
 * login substitution is needed. The cloud `githubPullRequests` table lacks
 * reviewer/mention columns, which is why these go through GitHub search.
 *
 * GitHub search AND-combines qualifiers within a single query, so the
 * `review-requested` union must run one search per qualifier and be merged here.
 */

export const PR_LIST_FILTERS = ["all", "created", "review-requested"] as const;

export type PrListFilter = (typeof PR_LIST_FILTERS)[number];

/** Minimal PR shape shared by the filter helpers (matches `parsePullRequests`). */
export interface PrListItem {
	prNumber: number;
	title: string;
	url: string;
	state: string;
}

/**
 * The GitHub search qualifier queries to run for a filter. Each entry is one
 * standalone `gh pr list --search <query>` call; an empty array means "list all
 * PRs with no search qualifier". Multiple entries are unioned by the caller
 * (GitHub AND-combines qualifiers inside one query, so OR must be done by us).
 */
export function searchQueriesForFilter(filter: PrListFilter): string[] {
	switch (filter) {
		case "all":
			return [];
		case "created":
			return ["author:@me"];
		case "review-requested":
			return ["review-requested:@me", "assignee:@me", "mentions:@me"];
	}
}

/**
 * Merge result sets from multiple qualifier searches into one list, deduping by
 * `prNumber` and preserving first-seen order (so the highest-priority qualifier
 * — listed first in `searchQueriesForFilter` — wins on collisions).
 */
export function mergePullRequestsByNumber<T extends PrListItem>(
	groups: T[][],
): T[] {
	const seen = new Map<number, T>();
	for (const group of groups) {
		for (const pr of group) {
			if (!seen.has(pr.prNumber)) {
				seen.set(pr.prNumber, pr);
			}
		}
	}
	return [...seen.values()];
}
