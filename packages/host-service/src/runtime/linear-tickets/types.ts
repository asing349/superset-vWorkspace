// Wave-7 M2 — shared types for the host-local Linear ticket poller + store.
//
// The poller fetches the viewer's Linear issues (assigned-to-me / created-by-me)
// with the M1 access token and caches them in the host-local `linear_tickets`
// table. NOTHING here is persisted to the cloud `tasks` table; this is a
// host-local cache only (read-time composition is M3's job).

export type LinearPriorityLabel = "urgent" | "high" | "medium" | "low" | "none";

/** A Linear issue assignee (non-secret display fields). */
export interface LinearIssueAssignee {
	id: string;
	name: string;
	email: string | null;
}

/** A Linear workflow state. */
export interface LinearIssueState {
	id: string;
	name: string;
	type: string;
}

/** The Linear team an issue belongs to. */
export interface LinearIssueTeam {
	id: string;
	key: string;
	name: string;
}

/**
 * A Linear issue as returned by the GraphQL API. Timestamps are ISO strings
 * (mapped to epoch ms when stored). This is the raw shape the client yields and
 * the poller maps into `linear_tickets` rows.
 */
export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	url: string;
	priority: number;
	createdAt: string;
	updatedAt: string;
	assignee: LinearIssueAssignee | null;
	state: LinearIssueState | null;
	team: LinearIssueTeam | null;
}

/** A Linear team for the team picker. */
export interface LinearTeam {
	id: string;
	key: string;
	name: string;
}

/**
 * The ticket shape streamed/returned to the renderer over tRPC. Derived purely
 * from a stored `linear_tickets` row — carries NO token material.
 */
export interface LocalLinearTicket {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	url: string;
	priority: number;
	priorityLabel: LinearPriorityLabel;
	state: {
		id: string | null;
		name: string | null;
		type: string | null;
	};
	assignee: LinearIssueAssignee | null;
	team: {
		id: string | null;
		key: string | null;
		name: string | null;
	} | null;
	/** Epoch ms (from Linear), or null when unknown. */
	createdAt: number | null;
	/** Epoch ms (from Linear), or null when unknown. */
	updatedAt: number | null;
	/** Host clock (epoch ms) at last upsert. */
	syncedAt: number;
}

/** Filter options for fetching/listing tickets. */
export interface TicketFilter {
	/** Narrow to a single Linear team id. */
	teamId?: string;
}

/** Result of a poll / manual refresh. */
export interface PollResult {
	/** False when there is no local token (the poll was a no-op). */
	polled: boolean;
	/** Number of issues upserted into the local store. */
	count: number;
}
