// Wave-7 M3 — source-agnostic ticket layer types.
//
// The host `tickets.*` surface resolves THE SINGLE ACTIVE SOURCE at read time
// (cloud-precedence: cloud when a cloud Linear connection is active, else the
// host-local Linear store, else nothing) and normalizes both into one unified
// DTO tagged with its `source`. Composition is READ-TIME ONLY — nothing here is
// persisted, and the local source is never written into the cloud `tasks` table.
// The `unifiedId` maps each ticket back to its origin so M4 can route writeback.

/** Which source a ticket resolved from. */
export type TicketSource = "cloud" | "local";

/** Normalized priority label (identical across cloud `tasks` + local Linear). */
export type UnifiedPriorityLabel =
	| "urgent"
	| "high"
	| "medium"
	| "low"
	| "none";

/**
 * One source-agnostic ticket. The renderer/pipeline read THIS shape and stay
 * blind to which source produced it (other than the `source` tag for a badge).
 */
export interface UnifiedTicket {
	/**
	 * Stable, source-prefixed id (`${source}:${sourceId}`) that maps back to its
	 * origin. M4 parses this to route writeback to the active source.
	 */
	unifiedId: string;
	/** The source this ticket resolved from. */
	source: TicketSource;
	/**
	 * The origin id WITHIN its source:
	 *  - cloud → the cloud `tasks.id` (UUID) used by `ctx.api.task.update`
	 *  - local → the Linear issue id (`linear_tickets.id`) for a direct Linear write
	 */
	sourceId: string;
	/** Human ticket key (cloud → `externalKey` ?? slug; local → Linear identifier). */
	identifier: string;
	title: string;
	description: string | null;
	/** Web URL when known (cloud → `externalUrl`; local → Linear issue url). */
	url: string | null;
	priority: UnifiedPriorityLabel;
	/** Workflow state/status display name, or null when unknown. */
	state: { name: string | null };
	/** Assignee display name, or null when unassigned/unknown. */
	assignee: { name: string | null } | null;
	/** Owning team (local only in v1; cloud `tasks` carry no team → null). */
	team: { key: string | null; name: string | null } | null;
	/** Epoch ms, or null when unknown. */
	createdAt: number | null;
	/** Epoch ms, or null when unknown. */
	updatedAt: number | null;
}

/** Read-time filter for the unified layer. */
export interface UnifiedTicketFilter {
	/** Narrow LOCAL tickets to a Linear team id. Ignored for the cloud source in v1. */
	teamId?: string;
}

/**
 * The resolved active source plus its tickets. `source` is `null` only when
 * NEITHER connection is active (the "not connected" case → empty list).
 */
export interface ResolvedTickets {
	source: TicketSource | null;
	tickets: UnifiedTicket[];
}

/**
 * Where a writeback for a ticket must go. A PURE mapping from a unified ticket's
 * `source`/`sourceId`; M4 dispatches on `kind` (cloud → `ctx.api.task.update`,
 * local → a direct Linear API update/comment with the host token).
 */
export type TicketWritebackTarget =
	| { kind: "cloud"; taskId: string }
	| { kind: "local"; issueId: string };
