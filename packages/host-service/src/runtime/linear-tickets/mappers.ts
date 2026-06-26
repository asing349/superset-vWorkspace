import type { linearTickets } from "../../db/schema";
import type {
	LinearIssue,
	LinearPriorityLabel,
	LocalLinearTicket,
} from "./types";

// Wave-7 M2 — pure mappers between Linear issues, `linear_tickets` rows, and the
// renderer-facing `LocalLinearTicket`. Ported (not imported) from the cloud
// `mapPriorityFromLinear` so the host carries no cloud-db dependency.

type LinearTicketRow = typeof linearTickets.$inferSelect;
type NewLinearTicketRow = typeof linearTickets.$inferInsert;

/** Linear's numeric priority (0 none, 1 urgent … 4 low) → a stable label. */
export function mapPriorityFromLinear(priority: number): LinearPriorityLabel {
	switch (priority) {
		case 1:
			return "urgent";
		case 2:
			return "high";
		case 3:
			return "medium";
		case 4:
			return "low";
		default:
			return "none";
	}
}

/** Parse an ISO timestamp to epoch ms; null on absent/invalid input. */
function toEpochMs(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? null : ms;
}

/** Map a fetched Linear issue into a `linear_tickets` upsert row. */
export function mapIssueToRow({
	issue,
	now,
}: {
	issue: LinearIssue;
	now: number;
}): NewLinearTicketRow {
	return {
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description ?? null,
		url: issue.url,
		priority: issue.priority ?? 0,
		stateId: issue.state?.id ?? null,
		stateName: issue.state?.name ?? null,
		stateType: issue.state?.type ?? null,
		assigneeId: issue.assignee?.id ?? null,
		assigneeName: issue.assignee?.name ?? null,
		assigneeEmail: issue.assignee?.email ?? null,
		teamId: issue.team?.id ?? null,
		teamKey: issue.team?.key ?? null,
		teamName: issue.team?.name ?? null,
		issueCreatedAt: toEpochMs(issue.createdAt),
		issueUpdatedAt: toEpochMs(issue.updatedAt),
		syncedAt: now,
	};
}

/** Map a stored row into the renderer-facing ticket shape. */
export function mapRowToTicket(row: LinearTicketRow): LocalLinearTicket {
	return {
		id: row.id,
		identifier: row.identifier,
		title: row.title,
		description: row.description ?? null,
		url: row.url,
		priority: row.priority,
		priorityLabel: mapPriorityFromLinear(row.priority),
		state: {
			id: row.stateId ?? null,
			name: row.stateName ?? null,
			type: row.stateType ?? null,
		},
		assignee: row.assigneeId
			? {
					id: row.assigneeId,
					name: row.assigneeName ?? "",
					email: row.assigneeEmail ?? null,
				}
			: null,
		team: row.teamId
			? {
					id: row.teamId,
					key: row.teamKey ?? null,
					name: row.teamName ?? null,
				}
			: null,
		createdAt: row.issueCreatedAt ?? null,
		updatedAt: row.issueUpdatedAt ?? null,
		syncedAt: row.syncedAt,
	};
}
