import type { DetectedPort } from "@superset/port-scanner";
import type { AgentIdentity } from "@superset/shared/agent-identity";
import type { FsWatchEvent } from "@superset/workspace-fs/host";
import type { AgentLifecycleEventType } from "./map-event-type.ts";

// ── Server → Client ────────────────────────────────────────────────

export interface FsEventsMessage {
	type: "fs:events";
	workspaceId: string;
	events: FsWatchEvent[];
}

/**
 * Group-addressed sibling of {@link FsEventsMessage} (Wave-2 M6). Folder roots
 * have no `workspaceId`, so they are addressed by `{groupId, rootId}` (resolved
 * to an absolute path via `getServiceForRootId`). The `events` payload is the
 * exact same `FsWatchEvent[]` shape as the workspace-keyed channel; only the
 * addressing differs, so the renderer can reuse its `fs:events` handling.
 */
export interface FsGroupEventsMessage {
	type: "fs:groupEvents";
	groupId: string;
	rootId: string;
	events: FsWatchEvent[];
}

export interface GitChangedMessage {
	type: "git:changed";
	workspaceId: string;
	/**
	 * Worktree-relative paths that changed when the batch was worktree-only.
	 * Absent means a broad git state change (`.git/` activity — commit, index,
	 * refs, or mixed) — consumers should invalidate everything for the
	 * workspace.
	 */
	paths?: string[];
}

export interface AgentLifecycleMessage {
	type: "agent:lifecycle";
	workspaceId: string;
	eventType: AgentLifecycleEventType;
	terminalId: string;
	// Absent when the hook ran without `SUPERSET_AGENT_ID` set (legacy shells
	// or third-party hook configs that bypass our wrappers).
	agent?: AgentIdentity;
	occurredAt: number;
}

export interface TerminalLifecycleMessage {
	type: "terminal:lifecycle";
	workspaceId: string;
	terminalId: string;
	eventType: "exit";
	exitCode: number;
	signal: number;
	occurredAt: number;
}

export interface PortChangedMessage {
	type: "port:changed";
	workspaceId: string;
	eventType: "add" | "remove";
	port: DetectedPort;
	label: string | null;
	occurredAt: number;
}

export interface EventBusErrorMessage {
	type: "error";
	message: string;
}

export type ServerMessage =
	| FsEventsMessage
	| FsGroupEventsMessage
	| GitChangedMessage
	| AgentLifecycleMessage
	| TerminalLifecycleMessage
	| PortChangedMessage
	| EventBusErrorMessage;

// ── Client → Server ────────────────────────────────────────────────

export interface FsWatchCommand {
	type: "fs:watch";
	workspaceId: string;
}

export interface FsUnwatchCommand {
	type: "fs:unwatch";
	workspaceId: string;
}

/**
 * Group-addressed sibling of {@link FsWatchCommand} (Wave-2 M6). Starts a watch
 * on the absolute path that `{groupId, rootId}` resolves to. Mirrors `fs:watch`
 * but for folder roots that have no `workspaceId`.
 */
export interface FsWatchGroupCommand {
	type: "fs:watchGroup";
	groupId: string;
	rootId: string;
}

export interface FsUnwatchGroupCommand {
	type: "fs:unwatchGroup";
	groupId: string;
	rootId: string;
}

export type ClientMessage =
	| FsWatchCommand
	| FsUnwatchCommand
	| FsWatchGroupCommand
	| FsUnwatchGroupCommand;
