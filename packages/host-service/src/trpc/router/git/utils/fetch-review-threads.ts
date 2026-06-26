import type { Octokit } from "@octokit/rest";
import type { IssueComment, PullRequestReviewThread } from "../types";
import {
	type GraphQLThreadsResult,
	parseGraphQLThreads,
	REVIEW_THREADS_QUERY,
} from "./graphql";

/**
 * Fetch a PR's review threads + conversation comments by explicit GitHub
 * coordinates (Wave 6, M4). Extracted out of `git.getPullRequestThreads` so the
 * fetch is parameterised purely by `(owner, name, prNumber)` — the workspace
 * surface resolves those from its workspace/project row, and the PR-review pane
 * passes them straight through for an ARBITRARY PR (no workspace required).
 *
 * Injecting `octokit` keeps this a PURE core that unit-tests against a fake
 * Octokit (mirroring `postReviewComment`). Both reads degrade independently:
 * a GraphQL or REST failure logs a warning and returns the empty slice rather
 * than throwing, so a partial GitHub outage still renders what it can.
 */
export interface FetchReviewThreadsInput {
	/** The Octokit the host already owns (`ctx.github()`). */
	octokit: Octokit;
	owner: string;
	name: string;
	prNumber: number;
}

export interface FetchReviewThreadsResult {
	reviewThreads: PullRequestReviewThread[];
	conversationComments: IssueComment[];
}

export async function fetchReviewThreads({
	octokit,
	owner,
	name,
	prNumber,
}: FetchReviewThreadsInput): Promise<FetchReviewThreadsResult> {
	let reviewThreads: PullRequestReviewThread[] = [];
	try {
		const result: GraphQLThreadsResult = await octokit.graphql(
			REVIEW_THREADS_QUERY,
			{ owner, name, prNumber },
		);
		reviewThreads = parseGraphQLThreads(result);
	} catch (error) {
		console.warn("[fetchReviewThreads] Failed to fetch review threads:", error);
	}

	const conversationComments: IssueComment[] = [];
	try {
		let page = 1;
		let hasMore = true;
		while (hasMore) {
			const { data: comments } = await octokit.issues.listComments({
				owner,
				repo: name,
				issue_number: prNumber,
				per_page: 100,
				page,
			});
			for (const c of comments) {
				const body = c.body?.trim();
				if (!body) continue;
				conversationComments.push({
					id: c.id,
					user: {
						login: c.user?.login ?? "ghost",
						avatarUrl: c.user?.avatar_url ?? "",
					},
					body,
					createdAt: c.created_at ?? "",
					htmlUrl: c.html_url ?? "",
				});
			}
			hasMore = comments.length === 100;
			page++;
		}
	} catch (error) {
		console.warn(
			"[fetchReviewThreads] Failed to fetch conversation comments:",
			error,
		);
	}

	return { reviewThreads, conversationComments };
}
