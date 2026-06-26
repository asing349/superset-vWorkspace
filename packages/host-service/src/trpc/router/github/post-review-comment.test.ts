import { describe, expect, it } from "bun:test";
import type { Octokit } from "@octokit/rest";
import {
	type PostReviewCommentInput,
	postReviewComment,
} from "./post-review-comment";

/**
 * Wave-6 M3 comment-post core test. `postReviewComment` is the pure core the
 * `github.createReviewComment` mutation wraps. With a fake Octokit it covers:
 *  - inline-vs-top-level path selection (path+line → `createReviewComment`; a
 *    missing line or path → the top-level `createReview` fallback),
 *  - redaction of the body BEFORE egress (no raw secret reaches GitHub),
 *  - the explicit-input contract: it only ever calls the ONE Octokit method the
 *    inputs select — there is no autonomous / dual-post path.
 */

interface RecordedCalls {
	reviewComment: Record<string, unknown>[];
	review: Record<string, unknown>[];
}

/** A fake Octokit recording exactly which write method fired, with its args. */
function fakeOctokit(calls: RecordedCalls): Octokit {
	return {
		pulls: {
			createReviewComment: async (arg: Record<string, unknown>) => {
				calls.reviewComment.push(arg);
				return {
					data: {
						id: 111,
						html_url: "https://github.com/acme/widget/pull/7#discussion_r111",
					},
				};
			},
			createReview: async (arg: Record<string, unknown>) => {
				calls.review.push(arg);
				return {
					data: {
						id: 222,
						html_url:
							"https://github.com/acme/widget/pull/7#pullrequestreview-222",
					},
				};
			},
		},
	} as unknown as Octokit;
}

function baseInput(
	calls: RecordedCalls,
	overrides: Partial<PostReviewCommentInput> = {},
): PostReviewCommentInput {
	return {
		octokit: fakeOctokit(calls),
		owner: "acme",
		repo: "widget",
		pullNumber: 7,
		commitId: "sha-head",
		body: "Off-by-one in the loop bound.",
		...overrides,
	};
}

function emptyCalls(): RecordedCalls {
	return { reviewComment: [], review: [] };
}

describe("postReviewComment — inline vs top-level selection", () => {
	it("posts an INLINE diff comment when path + line are present", async () => {
		const calls = emptyCalls();
		const result = await postReviewComment(
			baseInput(calls, { path: "src/app.ts", line: 42 }),
		);

		expect(calls.reviewComment.length).toBe(1);
		// The dual-post path never fires — exactly one Octokit write.
		expect(calls.review.length).toBe(0);
		expect(calls.reviewComment[0]).toMatchObject({
			owner: "acme",
			repo: "widget",
			pull_number: 7,
			commit_id: "sha-head",
			path: "src/app.ts",
			line: 42,
		});
		expect(result.inline).toBe(true);
		expect(result.id).toBe(111);
		expect(result.htmlUrl).toContain("discussion_r111");
	});

	it("falls back to a TOP-LEVEL review comment when there is no line", async () => {
		const calls = emptyCalls();
		const result = await postReviewComment(
			baseInput(calls, { path: "src/app.ts" }),
		);

		expect(calls.review.length).toBe(1);
		expect(calls.reviewComment.length).toBe(0);
		expect(calls.review[0]).toMatchObject({
			owner: "acme",
			repo: "widget",
			pull_number: 7,
			event: "COMMENT",
		});
		expect(result.inline).toBe(false);
		expect(result.id).toBe(222);
	});

	it("falls back to a top-level review comment when there is a line but no path", async () => {
		const calls = emptyCalls();
		const result = await postReviewComment(baseInput(calls, { line: 42 }));

		expect(calls.review.length).toBe(1);
		expect(calls.reviewComment.length).toBe(0);
		expect(result.inline).toBe(false);
	});

	it("posts top-level for a file-only / repo-wide finding (no path, no line)", async () => {
		const calls = emptyCalls();
		await postReviewComment(baseInput(calls));
		expect(calls.review.length).toBe(1);
		expect(calls.reviewComment.length).toBe(0);
	});
});

describe("postReviewComment — redaction before egress", () => {
	it("redacts a secret in the body on the inline path", async () => {
		const calls = emptyCalls();
		await postReviewComment(
			baseInput(calls, {
				path: "src/app.ts",
				line: 1,
				body: "Token leaked: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
			}),
		);

		const sentBody = calls.reviewComment[0]?.body as string;
		expect(sentBody).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
		expect(sentBody).toContain("[REDACTED]-GITHUB-TOKEN");
	});

	it("redacts a secret in the body on the top-level path", async () => {
		const calls = emptyCalls();
		await postReviewComment(
			baseInput(calls, {
				body: "AWS key AKIAIOSFODNN7EXAMPLE in config.",
			}),
		);

		const sentBody = calls.review[0]?.body as string;
		expect(sentBody).not.toContain("AKIAIOSFODNN7EXAMPLE");
		expect(sentBody).toContain("[REDACTED]-AWS-KEY");
	});
});
