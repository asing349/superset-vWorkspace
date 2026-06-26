import { describe, expect, it } from "bun:test";
import {
	buildPrLinkCommentBody,
	createLinearLocalWriteback,
	type LinearWorkflowState,
	type LinearWritebackClient,
	pickInReviewWorkflowStateId,
} from "./linear-writeback.ts";

// Wave-7 M4 — the host-side DIRECT Linear writeback for local-sourced ticket→PR
// runs. Everything runs against an injected fake client + fake auth — NO live
// Linear, NO `@linear/sdk`, NO network.

/** A fake Linear writeback client recording every call. */
function fakeClient(
	options: { states?: LinearWorkflowState[]; failStates?: boolean } = {},
) {
	const calls = {
		comments: [] as Array<{ issueId: string; body: string }>,
		listStates: [] as string[],
		stateUpdates: [] as Array<{ issueId: string; stateId: string }>,
	};
	const client: LinearWritebackClient = {
		async createComment(input) {
			calls.comments.push(input);
		},
		async listIssueWorkflowStates({ issueId }) {
			calls.listStates.push(issueId);
			if (options.failStates) throw new Error("states fetch failed");
			return options.states ?? [];
		},
		async updateIssueState(input) {
			calls.stateUpdates.push(input);
		},
	};
	return { client, calls };
}

describe("pickInReviewWorkflowStateId (W7-M4)", () => {
	it("prefers a state whose name contains 'review'", () => {
		const states: LinearWorkflowState[] = [
			{ id: "s1", name: "In Progress", type: "started" },
			{ id: "s2", name: "In Review", type: "started" },
		];
		expect(pickInReviewWorkflowStateId(states)).toBe("s2");
	});

	it("falls back to the first 'started' state when no review name", () => {
		const states: LinearWorkflowState[] = [
			{ id: "s1", name: "Backlog", type: "backlog" },
			{ id: "s2", name: "Doing", type: "started" },
		];
		expect(pickInReviewWorkflowStateId(states)).toBe("s2");
	});

	it("returns null when nothing sensible matches", () => {
		const states: LinearWorkflowState[] = [
			{ id: "s1", name: "Backlog", type: "backlog" },
			{ id: "s2", name: "Done", type: "completed" },
		];
		expect(pickInReviewWorkflowStateId(states)).toBeNull();
	});
});

describe("createLinearLocalWriteback (W7-M4)", () => {
	it("posts a PR-link comment AND moves the issue to an in-review state", async () => {
		const { client, calls } = fakeClient({
			states: [
				{ id: "todo", name: "Todo", type: "unstarted" },
				{ id: "rev", name: "In Review", type: "started" },
			],
		});
		const writeback = createLinearLocalWriteback({
			auth: { getAccessToken: () => "local-token" },
			createClient: () => client,
		});

		await writeback.writeBack({
			issueId: "issue-1",
			prUrl: "https://github.com/o/r/pull/7",
		});

		expect(calls.comments).toEqual([
			{
				issueId: "issue-1",
				body: buildPrLinkCommentBody("https://github.com/o/r/pull/7"),
			},
		]);
		expect(calls.stateUpdates).toEqual([
			{ issueId: "issue-1", stateId: "rev" },
		]);
	});

	it("still posts the comment when no in-review state resolves (no state move)", async () => {
		const { client, calls } = fakeClient({
			states: [{ id: "done", name: "Done", type: "completed" }],
		});
		const writeback = createLinearLocalWriteback({
			auth: { getAccessToken: () => "local-token" },
			createClient: () => client,
		});

		await writeback.writeBack({ issueId: "issue-1", prUrl: "https://pr/1" });

		expect(calls.comments).toHaveLength(1);
		expect(calls.stateUpdates).toHaveLength(0);
	});

	it("never throws when the best-effort state move fails (comment already landed)", async () => {
		const { client, calls } = fakeClient({ failStates: true });
		const writeback = createLinearLocalWriteback({
			auth: { getAccessToken: () => "local-token" },
			createClient: () => client,
		});

		await expect(
			writeback.writeBack({ issueId: "issue-1", prUrl: "https://pr/1" }),
		).resolves.toBeUndefined();
		expect(calls.comments).toHaveLength(1);
		expect(calls.stateUpdates).toHaveLength(0);
	});

	it("is a strict no-op with NO local token — never builds a client", async () => {
		let built = false;
		const writeback = createLinearLocalWriteback({
			auth: { getAccessToken: () => null },
			createClient: () => {
				built = true;
				return fakeClient().client;
			},
		});

		await writeback.writeBack({ issueId: "issue-1", prUrl: "https://pr/1" });
		expect(built).toBe(false);
	});

	it("rejects when the authoritative comment write fails", async () => {
		const failingClient: LinearWritebackClient = {
			async createComment() {
				throw new Error("comment failed");
			},
			async listIssueWorkflowStates() {
				return [];
			},
			async updateIssueState() {},
		};
		const writeback = createLinearLocalWriteback({
			auth: { getAccessToken: () => "local-token" },
			createClient: () => failingClient,
		});

		await expect(
			writeback.writeBack({ issueId: "issue-1", prUrl: "https://pr/1" }),
		).rejects.toThrow("comment failed");
	});
});
