import { describe, expect, it } from "bun:test";
import type { Octokit } from "@octokit/rest";
import { fetchReviewThreads } from "./fetch-review-threads";

/**
 * Wave-6 M4: `fetchReviewThreads` is the pure core that parameterises the
 * thread/comment read by explicit `(owner, name, prNumber)` — the seam that lets
 * the PR-review pane read threads for an ARBITRARY PR (not just the workspace's).
 * With a fake Octokit it covers:
 *  - the GraphQL vars carry owner/name/prNumber through verbatim, and the result
 *    is parsed into our thread shape;
 *  - conversation comments paginate (100 → fetch next page) and drop empties;
 *  - each read degrades INDEPENDENTLY (a GraphQL or REST throw returns the empty
 *    slice rather than failing the whole call).
 */

interface FakeOptions {
	threadsResult?: unknown;
	threadsError?: boolean;
	commentPages?: Array<Array<Record<string, unknown>>>;
	commentsError?: boolean;
	recordedGraphql?: { query: string; vars: Record<string, unknown> }[];
	recordedListCalls?: Record<string, unknown>[];
}

function fakeOctokit(opts: FakeOptions): Octokit {
	return {
		graphql: async (query: string, vars: Record<string, unknown>) => {
			opts.recordedGraphql?.push({ query, vars });
			if (opts.threadsError) throw new Error("graphql boom");
			return opts.threadsResult ?? emptyThreadsResult();
		},
		issues: {
			listComments: async (arg: Record<string, unknown>) => {
				opts.recordedListCalls?.push(arg);
				if (opts.commentsError) throw new Error("rest boom");
				const page = (arg.page as number) ?? 1;
				const data = opts.commentPages?.[page - 1] ?? [];
				return { data };
			},
		},
	} as unknown as Octokit;
}

function emptyThreadsResult() {
	return {
		repository: { pullRequest: { reviewThreads: { nodes: [] } } },
	};
}

function threadsResultWithOne() {
	return {
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: [
						{
							id: "THREAD_1",
							isResolved: false,
							diffSide: "RIGHT",
							comments: {
								nodes: [
									{
										id: "C1",
										databaseId: 9001,
										author: { login: "octocat", avatarUrl: "https://x/a" },
										body: "nit: rename this",
										createdAt: "2026-06-25T00:00:00Z",
										path: "src/app.ts",
										line: 12,
										originalLine: 12,
									},
								],
							},
						},
					],
				},
			},
		},
	};
}

describe("fetchReviewThreads — coordinate plumbing", () => {
	it("passes owner/name/prNumber to the GraphQL query and parses the threads", async () => {
		const recordedGraphql: { query: string; vars: Record<string, unknown> }[] =
			[];
		const result = await fetchReviewThreads({
			octokit: fakeOctokit({
				threadsResult: threadsResultWithOne(),
				recordedGraphql,
			}),
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});

		expect(recordedGraphql.length).toBe(1);
		expect(recordedGraphql[0]?.vars).toMatchObject({
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});
		expect(result.reviewThreads.length).toBe(1);
		expect(result.reviewThreads[0]).toMatchObject({
			id: "THREAD_1",
			isResolved: false,
			path: "src/app.ts",
			line: 12,
		});
	});

	it("passes owner/name(prNumber) as REST owner/repo/issue_number for comments", async () => {
		const recordedListCalls: Record<string, unknown>[] = [];
		await fetchReviewThreads({
			octokit: fakeOctokit({
				commentPages: [[]],
				recordedListCalls,
			}),
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});

		expect(recordedListCalls[0]).toMatchObject({
			owner: "acme",
			repo: "widget",
			issue_number: 42,
			per_page: 100,
			page: 1,
		});
	});
});

describe("fetchReviewThreads — comment pagination + filtering", () => {
	it("paginates while a full page (100) comes back and drops empty bodies", async () => {
		const fullPage = Array.from({ length: 100 }, (_, i) => ({
			id: i + 1,
			body: `comment ${i + 1}`,
			user: { login: "u", avatar_url: "" },
			created_at: "2026-06-25T00:00:00Z",
			html_url: "https://x",
		}));
		const secondPage = [
			{
				id: 1000,
				body: "   ", // whitespace-only → dropped
				user: { login: "u", avatar_url: "" },
				created_at: "",
				html_url: "",
			},
			{
				id: 1001,
				body: "real tail comment",
				user: { login: "u", avatar_url: "" },
				created_at: "",
				html_url: "",
			},
		];
		const result = await fetchReviewThreads({
			octokit: fakeOctokit({ commentPages: [fullPage, secondPage] }),
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});

		// 100 from page 1 + 1 kept from page 2 (the blank one dropped).
		expect(result.conversationComments.length).toBe(101);
		expect(
			result.conversationComments.some((c) => c.body === "real tail comment"),
		).toBe(true);
	});
});

describe("fetchReviewThreads — independent degradation", () => {
	it("returns empty threads (still returns comments) when GraphQL throws", async () => {
		const result = await fetchReviewThreads({
			octokit: fakeOctokit({
				threadsError: true,
				commentPages: [
					[
						{
							id: 1,
							body: "still here",
							user: { login: "u", avatar_url: "" },
							created_at: "",
							html_url: "",
						},
					],
				],
			}),
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});

		expect(result.reviewThreads).toEqual([]);
		expect(result.conversationComments.length).toBe(1);
	});

	it("returns empty comments (still returns threads) when listComments throws", async () => {
		const result = await fetchReviewThreads({
			octokit: fakeOctokit({
				threadsResult: threadsResultWithOne(),
				commentsError: true,
			}),
			owner: "acme",
			name: "widget",
			prNumber: 42,
		});

		expect(result.reviewThreads.length).toBe(1);
		expect(result.conversationComments).toEqual([]);
	});
});
