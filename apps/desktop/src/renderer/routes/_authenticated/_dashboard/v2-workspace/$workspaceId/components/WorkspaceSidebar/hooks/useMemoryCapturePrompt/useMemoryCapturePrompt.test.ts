import { describe, expect, test } from "bun:test";
import type {
	BranchSyncStatus,
	PRFlowState,
	PullRequest,
} from "../../components/PRActionHeader/utils/getPRFlowState";
import { selectCapturePromptTarget } from "./useMemoryCapturePrompt";

const sync: BranchSyncStatus = {
	hasRepo: true,
	hasUpstream: true,
	pushCount: 0,
	pullCount: 0,
	isDefaultBranch: false,
	isDetached: false,
	hasUncommitted: false,
	currentBranch: "feature-x",
	defaultBranch: "main",
};

const pr = (_overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 42,
	url: "https://github.com/org/repo/pull/42",
	title: "Feature X",
	body: null,
	state: "open",
	isDraft: false,
	reviewDecision: null,
	mergeable: "unknown",
	headRefName: "feature-x",
	updatedAt: "",
	checks: [],
	repoOwner: "org",
	repoName: "repo",
});

describe("selectCapturePromptTarget", () => {
	test("returns the PR identity when a PR exists", () => {
		const state: PRFlowState = { kind: "pr-exists", pr: pr(), sync };
		expect(selectCapturePromptTarget(state)).toEqual({
			prNumber: 42,
			prUrl: "https://github.com/org/repo/pull/42",
			prTitle: "Feature X",
		});
	});

	test("returns null for every non-pr-exists state", () => {
		const states: PRFlowState[] = [
			{ kind: "loading" },
			{ kind: "unavailable", reason: "no-repo" },
			{ kind: "no-pr", sync },
			{ kind: "busy", pr: pr() },
			{ kind: "error", pr: pr(), message: "x" },
		];
		for (const state of states) {
			expect(selectCapturePromptTarget(state)).toBeNull();
		}
	});

	test("carries the PR title (the intent source) through unchanged", () => {
		const state: PRFlowState = {
			kind: "pr-exists",
			pr: pr(),
			sync,
		};
		// title overridden for clarity
		(state.pr as PullRequest).title = "Wire memory into PR flow";
		expect(selectCapturePromptTarget(state)?.prTitle).toBe(
			"Wire memory into PR flow",
		);
	});
});
