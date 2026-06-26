import { LinearClient } from "@linear/sdk";
import type { TicketAuthTokenSource } from "../linear-tickets";

// Wave-7 M4 — host-side DIRECT Linear writeback for LOCAL-sourced ticket→PR runs.
//
// When the active source is the host-local Linear connection (M1/M2), the
// wave-4 PR-loop reconciler must NOT round-trip through the cloud
// `ctx.api.task.update` (there is no cloud task). Instead it writes status/comment
// back DIRECTLY to the Linear API with the M1 host token: a PR-link comment plus a
// best-effort move to an "in review" workflow state. The access token NEVER leaves
// this layer and is NEVER logged. The low-level Linear ops are behind an injectable
// `LinearWritebackClient` so the reconciler/tests run against a fake (no live API).

/**
 * The direct-Linear writeback surface a local-sourced run uses. Mirrors the cloud
 * `TicketTaskWriteback` role but targets a Linear issue id with the host token.
 */
export interface LocalTicketWriteback {
	/**
	 * Write the PR link back to a Linear issue: a comment carrying the PR url, plus
	 * a best-effort move to an "in review" workflow state. The comment is the
	 * authoritative write (a failure rejects so the caller can mark the writeback
	 * failed); the state move is best-effort and never fails the writeback. A no-op
	 * (never throws) when there is no local token.
	 */
	writeBack(input: { issueId: string; prUrl: string }): Promise<void>;
}

/** A Linear workflow state (id/name/type) used by the in-review heuristic. */
export interface LinearWorkflowState {
	id: string;
	name: string;
	type: string;
}

/**
 * The low-level Linear writes the local writeback needs — injectable so tests use
 * a fake and the `@linear/sdk` is never imported by tests / never hits the network.
 */
export interface LinearWritebackClient {
	/** Add a comment to a Linear issue (the PR-link note). */
	createComment(input: { issueId: string; body: string }): Promise<void>;
	/** The workflow states of the issue's team (for the in-review heuristic). */
	listIssueWorkflowStates(input: {
		issueId: string;
	}): Promise<LinearWorkflowState[]>;
	/** Move an issue to a workflow state. */
	updateIssueState(input: { issueId: string; stateId: string }): Promise<void>;
}

/** Build a writeback client from a (decrypted, host-internal) access token. */
export type LinearWritebackClientFactory = (input: {
	accessToken: string;
}) => LinearWritebackClient;

/**
 * Pure in-review heuristic over Linear workflow states — mirrors the cloud
 * `resolveInReviewStatusId`: prefer a state whose NAME contains "review", else the
 * first `started`-type state, else null (the caller then writes only the comment).
 */
export function pickInReviewWorkflowStateId(
	states: readonly LinearWorkflowState[],
): string | null {
	const byReviewName = states.find((state) =>
		state.name.toLowerCase().includes("review"),
	);
	if (byReviewName) return byReviewName.id;
	const started = states.find((state) => state.type === "started");
	return started?.id ?? null;
}

/** The (short, non-secret) PR-link comment body written back to the issue. */
export function buildPrLinkCommentBody(prUrl: string): string {
	return `Autonomous run opened a pull request: ${prUrl}`;
}

/** Real implementation backed by `@linear/sdk` (`new LinearClient({ accessToken })`). */
export class SdkLinearWritebackClient implements LinearWritebackClient {
	private readonly client: LinearClient;

	constructor({ accessToken }: { accessToken: string }) {
		this.client = new LinearClient({ accessToken });
	}

	async createComment({
		issueId,
		body,
	}: {
		issueId: string;
		body: string;
	}): Promise<void> {
		await this.client.createComment({ issueId, body });
	}

	async listIssueWorkflowStates({
		issueId,
	}: {
		issueId: string;
	}): Promise<LinearWorkflowState[]> {
		const issue = await this.client.issue(issueId);
		const team = await issue.team;
		if (!team) return [];
		const states = await team.states();
		return states.nodes.map((state) => ({
			id: state.id,
			name: state.name,
			type: state.type,
		}));
	}

	async updateIssueState({
		issueId,
		stateId,
	}: {
		issueId: string;
		stateId: string;
	}): Promise<void> {
		await this.client.updateIssue(issueId, { stateId });
	}
}

/** Factory used by production wiring (overridable in tests). */
export const createSdkLinearWritebackClient: LinearWritebackClientFactory = ({
	accessToken,
}) => new SdkLinearWritebackClient({ accessToken });

export interface CreateLinearLocalWritebackDeps {
	/** Host-internal access-token source (M1 `LinearLocalAuthStore`). */
	auth: TicketAuthTokenSource;
	/** Builds the Linear writeback client (real SDK by default; a fake in tests). */
	createClient?: LinearWritebackClientFactory;
}

/**
 * Build the production {@link LocalTicketWriteback} backed by the host-local M1
 * Linear token. No cloud round-trip: the PR-link comment + best-effort in-review
 * state move go DIRECTLY to Linear. The token is resolved lazily per-write (so a
 * disconnect makes this a strict no-op) and is NEVER logged.
 */
export function createLinearLocalWriteback(
	deps: CreateLinearLocalWritebackDeps,
): LocalTicketWriteback {
	const createClient = deps.createClient ?? createSdkLinearWritebackClient;
	return {
		async writeBack({ issueId, prUrl }) {
			const token = deps.auth.getAccessToken();
			// No local token → nothing to write to (e.g. disconnected). Strict no-op:
			// never builds a client, never hits the network, never logs the token.
			if (!token) {
				console.warn(
					"[host-service:ticket-run] local Linear writeback skipped — no local token",
					{ issueId },
				);
				return;
			}
			const client = createClient({ accessToken: token });
			// The PR-link comment is the authoritative write (must succeed).
			await client.createComment({
				issueId,
				body: buildPrLinkCommentBody(prUrl),
			});
			// Best-effort: move the issue to an "in review" state. A failure here NEVER
			// fails the writeback (the comment already landed).
			try {
				const states = await client.listIssueWorkflowStates({ issueId });
				const stateId = pickInReviewWorkflowStateId(states);
				if (stateId) await client.updateIssueState({ issueId, stateId });
			} catch (error) {
				console.warn(
					"[host-service:ticket-run] local Linear state move failed (best-effort)",
					{ issueId, error: error instanceof Error ? error.message : error },
				);
			}
		},
	};
}
