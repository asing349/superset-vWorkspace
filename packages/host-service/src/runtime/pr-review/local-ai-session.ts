import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaces } from "../../db/schema.ts";
import type { ChatRuntimeManager } from "../chat/index.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";

/**
 * Local-AI session adapter (Wave 5, M4 wiring).
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
 * NOTE on `complete`: the chat harness is a STREAMING, interactive surface
 * (`sendMessage` is fire-and-forget; the reply is read by polling
 * `getSnapshot`/`listMessages`, and a run may raise tool-approval / sandbox
 * questions). A robust one-shot bridge (drive a transient session, poll to
 * completion, extract the assistant text) is a self-contained follow-up; until
 * it lands, `complete` returns `null` so enrichment cleanly degrades to the
 * deterministic skeleton rather than risking a hung or half-driven session. The
 * port boundary means swapping in the streaming implementation is local to this
 * file and changes nothing in the enrichment core.
 */

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

/**
 * Build the enrichment session for a project. Returns `null` when the project
 * has no workspace (no local agent possible) — the caller then generates the
 * deterministic + grounded guide.
 */
export function createLocalAiSession(
	deps: LocalAiSessionDeps,
): GuideEnrichmentSession | null {
	const { db, projectId } = deps;
	const workspace = findWorkspaceForProject(db, projectId);
	if (!workspace) return null;

	return {
		isAvailable: () => true,
		// Streaming one-shot bridge is the documented follow-up (see file header).
		// Returning null keeps enrichment best-effort: the guide degrades to the
		// deterministic + grounded skeleton, never hangs, never throws.
		complete: async () => null,
	};
}
