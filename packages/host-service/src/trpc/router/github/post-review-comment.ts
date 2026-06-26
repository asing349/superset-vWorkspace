import type { Octokit } from "@octokit/rest";
import { redactText } from "@superset/memory";

/**
 * Post one PR review comment (Wave 6, M3) — the ONE new GitHub write surface
 * beyond wave-5's read-only core. This is a PURE core (injected `octokit`) so it
 * unit-tests with a fake Octokit; the `github.createReviewComment` mutation wraps
 * it with `ctx.github()`.
 *
 * It is invoked ONLY from an explicit per-finding "Post comment" click in the
 * renderer (never autonomously, never in bulk — Assumption A4). Two paths, one
 * shape:
 *  - inline review comment (`octokit.pulls.createReviewComment`) when the finding
 *    carries a usable NEW-side `path` + `line` (M1's anti-hallucination guard
 *    guarantees the path is in the diff and the line is a real NEW-side line, so
 *    the inline anchor is safe);
 *  - a top-level PR review comment (`octokit.pulls.createReview`, `event:
 *    "COMMENT"`) as the fallback for a file-only / repo-wide finding with no
 *    usable line.
 *
 * The `body` is ALWAYS redacted (`redactText`) before egress — finding text is
 * model-derived, so no raw secret shape ever reaches GitHub.
 */

export interface PostReviewCommentInput {
	/** The write-capable Octokit the host already owns (`ctx.github()`). */
	octokit: Octokit;
	owner: string;
	repo: string;
	pullNumber: number;
	/** The commit the comment anchors to — the reviewed head SHA. */
	commitId: string;
	/** The comment text; redacted here before it is sent. */
	body: string;
	/** NEW-side repo-relative path — present for an inline diff comment. */
	path?: string;
	/** 1-based NEW-side line — present for an inline diff comment. */
	line?: number;
}

export interface PostReviewCommentResult {
	/** GitHub's id for the created comment / review. */
	id: number;
	/** The created comment's html URL, for the renderer to confirm + link. */
	htmlUrl: string;
	/** True when posted inline on the diff; false when posted as a top-level review. */
	inline: boolean;
}

export async function postReviewComment({
	octokit,
	owner,
	repo,
	pullNumber,
	commitId,
	body,
	path,
	line,
}: PostReviewCommentInput): Promise<PostReviewCommentResult> {
	// Redact BEFORE any egress — never post raw finding/model text to GitHub.
	const redactedBody = redactText(body).text;

	// Inline only when BOTH a path and a line are present (a file-only finding,
	// or a path with no line, falls through to the top-level review path).
	if (path && line !== undefined) {
		const { data } = await octokit.pulls.createReviewComment({
			owner,
			repo,
			pull_number: pullNumber,
			commit_id: commitId,
			path,
			line,
			body: redactedBody,
		});
		return { id: data.id, htmlUrl: data.html_url, inline: true };
	}

	const { data } = await octokit.pulls.createReview({
		owner,
		repo,
		pull_number: pullNumber,
		commit_id: commitId,
		event: "COMMENT",
		body: redactedBody,
	});
	return { id: data.id, htmlUrl: data.html_url, inline: false };
}
