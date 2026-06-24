import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaces } from "../../db/schema.ts";
import type { ChatRuntimeManager } from "../chat/index.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";

/**
 * Local-AI session adapter (Wave 5, M4 — live one-shot bridge).
 *
 * Bridges the host's on-device chat runtime (`ctx.runtime.chat`) to the narrow
 * {@link GuideEnrichmentSession} port the enrichment consumes. "Local" = the
 * user's OWN connected/on-device agent — NO new Superset cloud model call.
 *
 * Availability is gated on a workspace existing for the PR's project: a
 * workspace (a checked-out worktree) is the prerequisite for any local agent
 * run, and `ChatRuntimeManager` is workspace-bound. When no workspace exists for
 * the project, the session reports unavailable and the guide stays deterministic
 * + grounded (the specified no-session fallback).
 *
 * `complete` drives a SAFE one-shot: spin up a transient chat session bound to
 * the workspace, send the read-only enrichment prompt, poll the harness display
 * state until the run SETTLES (idle, not streaming), extract the assistant's
 * final text, and ALWAYS tear the session down. Hard safety, all enforced here:
 *
 *   - Strict wall-clock timeout (≤ {@link MAX_DRIVE_MS}); on timeout → stop +
 *     dispose + return null. Never hangs the host.
 *   - The prompt is pure text analysis and needs no tools. If the run raises a
 *     tool-approval / sandbox / plan / question, we DO NOT auto-approve — we
 *     stop and return null (the deterministic skeleton is the result).
 *   - ANY error (missing provider creds, send failure, empty/garbled reply) →
 *     return null. Never throws out of `complete`.
 *
 * The chat harness (mastracode) is fire-and-forget + streaming: `sendMessage`
 * returns immediately and the reply is read by polling `getSnapshot`. We depend
 * only on the documented public `ChatRuntimeManager` methods and a narrow
 * structural view of the harness display/message shapes (no new manager methods,
 * no exposed internals).
 */

/** Hard upper bound on the whole drive (send + poll + extract). */
const MAX_DRIVE_MS = 45_000;
/** Poll interval while waiting for the run to settle. */
const POLL_INTERVAL_MS = 250;

export interface LocalAiSessionDeps {
	db: HostDb;
	chat: ChatRuntimeManager;
	projectId: string;
}

/** Find any workspace bound to a project (the local-agent prerequisite). */
function findWorkspaceForProject(
	db: HostDb,
	projectId: string,
): { id: string; worktreePath: string } | null {
	const row = db.query.workspaces
		.findFirst({ where: eq(workspaces.projectId, projectId) })
		.sync();
	if (!row?.worktreePath) return null;
	return { id: row.id, worktreePath: row.worktreePath };
}

// ---------------------------------------------------------------------------
// Narrow structural views of the (opaque) harness display/message shapes.
// We read ONLY the fields documented on @mastra/core HarnessDisplayState /
// HarnessMessage, defensively (every field optional), so we never depend on
// `any` and stay robust to the rest of the streaming surface.
// ---------------------------------------------------------------------------

interface DisplayStateView {
	/** True while the agent is actively running a turn. */
	isRunning?: boolean;
	/** Non-null while a message is still streaming. */
	currentMessage?: unknown;
	/** Non-null when a tool call is blocked awaiting approval. */
	pendingApproval?: unknown;
	/** Non-null when a tool is suspended awaiting resume data. */
	pendingSuspension?: unknown;
	/** Non-null when an `ask_user` / sandbox question is blocking. */
	pendingQuestion?: unknown;
	/** Non-null when a plan is awaiting approval. */
	pendingPlanApproval?: unknown;
}

interface MessageContentView {
	type?: string;
	text?: string;
}

interface MessageView {
	role?: string;
	content?: MessageContentView[];
}

interface SnapshotView {
	displayState?: DisplayStateView;
	messages?: MessageView[];
}

/** True when the run has hit a state that needs human interaction (we bail). */
function isBlockedByHuman(state: DisplayStateView): boolean {
	return (
		state.pendingApproval != null ||
		state.pendingSuspension != null ||
		state.pendingQuestion != null ||
		state.pendingPlanApproval != null
	);
}

/** True once the agent has finished its turn (idle, nothing streaming). */
function isSettled(state: DisplayStateView): boolean {
	return state.isRunning !== true && state.currentMessage == null;
}

/** Extract the final assistant message's concatenated text, or null. */
function extractAssistantText(messages: readonly MessageView[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const text = (message.content ?? [])
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join("\n")
			.trim();
		return text.length > 0 ? text : null;
	}
	return null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drive the prompt through a transient session to a settled reply. Returns the
 * assistant text, or null on timeout / human-blocked / empty. Caller owns
 * teardown (so teardown still runs if THIS throws — though it shouldn't).
 */
async function driveOneShot(options: {
	chat: ChatRuntimeManager;
	sessionId: string;
	workspaceId: string;
	prompt: string;
	deadline: number;
}): Promise<string | null> {
	const { chat, sessionId, workspaceId, prompt, deadline } = options;

	// Fire the prompt. sendMessage is fire-and-forget; a creation/provider error
	// surfaces here and is caught by the outer `complete`.
	await chat.sendMessage({
		sessionId,
		workspaceId,
		payload: { content: prompt },
	});

	// Poll until the run settles, a human-block appears, or we hit the deadline.
	while (Date.now() < deadline) {
		const snapshot = (await chat.getSnapshot({
			sessionId,
			workspaceId,
		})) as SnapshotView;
		const state = snapshot.displayState ?? {};

		if (isBlockedByHuman(state)) {
			// Read-only enrichment should never need a tool/approval; if it does,
			// we refuse to auto-approve — bail to the deterministic skeleton.
			return null;
		}

		if (isSettled(state)) {
			return extractAssistantText(snapshot.messages ?? []);
		}

		await delay(POLL_INTERVAL_MS);
	}

	// Timed out waiting for the run to settle.
	return null;
}

/** Best-effort stop + dispose of the transient session. Never throws. */
async function teardown(
	chat: ChatRuntimeManager,
	sessionId: string,
	workspaceId: string,
): Promise<void> {
	try {
		await chat.stop({ sessionId, workspaceId });
	} catch {
		// best-effort — proceed to dispose regardless
	}
	try {
		await chat.disposeRuntime(sessionId, workspaceId);
	} catch {
		// best-effort — runtime may already be gone
	}
}

/**
 * Build the enrichment session for a project. Returns `null` when the project
 * has no workspace (no local agent possible) — the caller then generates the
 * deterministic + grounded guide.
 */
export function createLocalAiSession(
	deps: LocalAiSessionDeps,
): GuideEnrichmentSession | null {
	const { db, chat, projectId } = deps;
	const workspace = findWorkspaceForProject(db, projectId);
	if (!workspace) return null;
	const workspaceId = workspace.id;

	return {
		isAvailable: () => true,
		complete: async ({ prompt, signal }) => {
			// Already-aborted callers short-circuit before spinning a session.
			if (signal?.aborted) return null;

			const sessionId = randomUUID();
			const deadline = Date.now() + MAX_DRIVE_MS;

			try {
				// Race the drive against a hard wall-clock timeout so a stuck run can
				// never hang the host: whichever resolves first wins, and teardown
				// runs regardless in the `finally`.
				return await Promise.race([
					driveOneShot({ chat, sessionId, workspaceId, prompt, deadline }),
					delay(MAX_DRIVE_MS).then<null>(() => null),
				]);
			} catch {
				// Any failure (missing provider creds, send/poll error) → degrade to
				// the deterministic skeleton. Never throws out of `complete`.
				return null;
			} finally {
				await teardown(chat, sessionId, workspaceId);
			}
		},
	};
}
