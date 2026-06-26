/**
 * Parse the `{ owner, repo }` of a PR from its GitHub html URL (Wave 6, M3).
 *
 * The PR-review pane already fetches the PR row (`projects.listPullRequests`),
 * whose `url` is the PR's GitHub html URL
 * (`https://github.com/{owner}/{repo}/pull/{n}`). The M3 "Post comment" action
 * needs `owner` + `repo` to call `github.createReviewComment`; deriving them from
 * that URL avoids a second host round-trip and keeps this PURE + browser-safe
 * (no Node imports). Returns `null` for a missing / non-GitHub-PR URL, so the
 * caller can disable posting rather than guessing.
 */
export interface PrTarget {
	owner: string;
	repo: string;
}

const PR_URL_PATTERN = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/i;

export function parsePrTarget(url: string | null | undefined): PrTarget | null {
	if (!url) return null;
	const match = PR_URL_PATTERN.exec(url);
	if (!match) return null;
	const owner = match[1];
	const repo = match[2];
	if (!owner || !repo) return null;
	return { owner, repo };
}
