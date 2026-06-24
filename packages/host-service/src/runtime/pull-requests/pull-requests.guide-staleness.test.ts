import { describe, expect, test } from "bun:test";
import { pullRequests, workspaces } from "../../db/schema";
import {
	type PullRequestHeadChangedListener,
	PullRequestRuntimeManager,
} from "./pull-requests";

/**
 * Wave-5 M6 focused staleness wiring test. The PR runtime fires
 * `onPullRequestHeadChanged` exactly when an EXISTING PR row's head SHA
 * advances (a new commit), so app.ts can mark a cached guide stale — and it
 * does NOT fire on a first insert or an unchanged SHA. This test exercises the
 * real `upsertPullRequestRow` path via `linkWorkspaceToCheckoutPullRequest`,
 * asserting the hook events (the guardrail: the runtime never regenerates — it
 * only emits the head-changed event; marking is a pure cache write).
 */

const PROJECT_ID = "project-1";
const WORKSPACE_ID = "workspace-1";

interface FakePullRequest {
	id: string;
	projectId: string;
	repoProvider: "github";
	repoOwner: string;
	repoName: string;
	prNumber: number;
	url: string;
	title: string;
	state: string;
	isDraft: boolean;
	headBranch: string;
	headSha: string;
	reviewDecision: string | null;
	checksStatus: string;
	checksJson: string;
	lastFetchedAt: number | null;
	error: string | null;
	createdAt: number;
	updatedAt: number;
}

interface FakeWorkspace {
	id: string;
	projectId: string;
	pullRequestId: string | null;
	headSha: string | null;
	upstreamOwner: string | null;
	upstreamRepo: string | null;
	upstreamBranch: string | null;
}

interface FakeState {
	pullRequest: FakePullRequest | undefined;
	workspace: FakeWorkspace;
}

const PROJECT = {
	id: PROJECT_ID,
	repoPath: "/repo",
	repoProvider: "github" as const,
	repoOwner: "base-owner",
	repoName: "base-repo",
	repoUrl: "https://github.com/base-owner/base-repo.git",
	remoteName: "origin",
};

function makeState(existing?: FakePullRequest): FakeState {
	return {
		pullRequest: existing,
		workspace: {
			id: WORKSPACE_ID,
			projectId: PROJECT_ID,
			pullRequestId: null,
			headSha: null,
			upstreamOwner: null,
			upstreamRepo: null,
			upstreamBranch: null,
		},
	};
}

function createFakeDb(state: FakeState) {
	return {
		query: {
			projects: { findFirst: () => ({ sync: () => PROJECT }) },
			pullRequests: { findFirst: () => ({ sync: () => state.pullRequest }) },
		},
		insert: (table: unknown) => ({
			values: (values: FakePullRequest) => ({
				run: () => {
					if (table === pullRequests) state.pullRequest = values;
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: Partial<FakePullRequest> | Partial<FakeWorkspace>) => ({
				where: () => ({
					run: () => {
						if (table === pullRequests && state.pullRequest) {
							state.pullRequest = {
								...state.pullRequest,
								...(values as Partial<FakePullRequest>),
							};
						}
						if (table === workspaces) {
							state.workspace = {
								...state.workspace,
								...(values as Partial<FakeWorkspace>),
							};
						}
					},
				}),
			}),
		}),
	};
}

interface HeadChangedEvent {
	projectId: string;
	prNumber: number;
	newHeadSha: string;
}

function createManager(
	state: FakeState,
	onPullRequestHeadChanged: PullRequestHeadChangedListener,
) {
	return new PullRequestRuntimeManager({
		db: createFakeDb(state) as never,
		execGh: (async () => {
			throw new Error("gh not used");
		}) as never,
		git: async () => {
			throw new Error("git not used");
		},
		github: async () => {
			throw new Error("github not used");
		},
		gitWatcher: { onChanged: () => () => {} } as never,
		onPullRequestHeadChanged,
	});
}

function linkWith(
	state: FakeState,
	headSha: string,
	onPullRequestHeadChanged: PullRequestHeadChangedListener,
) {
	const manager = createManager(state, onPullRequestHeadChanged);
	return manager.linkWorkspaceToCheckoutPullRequest({
		workspaceId: WORKSPACE_ID,
		projectId: PROJECT_ID,
		pullRequest: {
			number: 42,
			url: "https://github.com/base-owner/base-repo/pull/42",
			title: "T",
			state: "open",
			isDraft: false,
			headRefName: "feat",
			headRefOid: headSha,
			headRepositoryOwner: "base-owner",
			headRepositoryName: "base-repo",
			isCrossRepository: false,
		},
	});
}

function existingRow(headSha: string): FakePullRequest {
	return {
		id: "pr-existing",
		projectId: PROJECT_ID,
		repoProvider: "github",
		repoOwner: "base-owner",
		repoName: "base-repo",
		prNumber: 42,
		url: "https://github.com/base-owner/base-repo/pull/42",
		title: "T",
		state: "open",
		isDraft: false,
		headBranch: "feat",
		headSha,
		reviewDecision: null,
		checksStatus: "pending",
		checksJson: "[]",
		lastFetchedAt: null,
		error: null,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("M6 staleness wiring at upsertPullRequestRow", () => {
	test("fires onPullRequestHeadChanged when an existing PR's head SHA advances", async () => {
		const state = makeState(existingRow("old-sha"));
		const events: HeadChangedEvent[] = [];

		await linkWith(state, "new-sha", (e) => events.push(e));

		// The hook fires ONCE with the new SHA — app.ts marks the guide stale.
		expect(events).toEqual([
			{ projectId: PROJECT_ID, prNumber: 42, newHeadSha: "new-sha" },
		]);
		// The runtime did not regenerate anything — it only updated the PR row.
		expect(state.pullRequest?.headSha).toBe("new-sha");
	});

	test("does NOT fire on a first insert (no prior PR row)", async () => {
		const state = makeState(undefined);
		const events: HeadChangedEvent[] = [];

		await linkWith(state, "first-sha", (e) => events.push(e));

		expect(events).toEqual([]);
		expect(state.pullRequest?.headSha).toBe("first-sha");
	});

	test("does NOT fire when the head SHA is unchanged", async () => {
		const state = makeState(existingRow("same-sha"));
		const events: HeadChangedEvent[] = [];

		await linkWith(state, "same-sha", (e) => events.push(e));

		expect(events).toEqual([]);
	});

	test("a throwing listener is swallowed (PR sync never fails on guide work)", async () => {
		const state = makeState(existingRow("old-sha"));

		const promise = linkWith(state, "new-sha", () => {
			throw new Error("guide cache exploded");
		});

		// The link still resolves; the row still updated.
		await expect(promise).resolves.toBeTypeOf("string");
		expect(state.pullRequest?.headSha).toBe("new-sha");
	});
});
