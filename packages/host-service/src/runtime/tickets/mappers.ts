import type { LocalLinearTicket } from "../linear-tickets";
import { makeUnifiedTicketId } from "./id";
import type { UnifiedPriorityLabel, UnifiedTicket } from "./types";

// Wave-7 M3 — PURE mappers normalizing each source into the unified DTO. No I/O
// here: the cloud adapter (`cloud-source.ts`) fetches rows and the local store
// (M2) returns `LocalLinearTicket`s; these only RESHAPE + tag `source`.

const PRIORITY_LABELS: readonly UnifiedPriorityLabel[] = [
	"urgent",
	"high",
	"medium",
	"low",
	"none",
];

/** Coerce an unknown priority into the unified label set (default "none"). */
function toPriorityLabel(
	value: string | null | undefined,
): UnifiedPriorityLabel {
	return value && (PRIORITY_LABELS as readonly string[]).includes(value)
		? (value as UnifiedPriorityLabel)
		: "none";
}

/** Coerce a Date | ISO string | epoch ms | null into epoch ms (or null). */
function toEpochMs(
	value: Date | string | number | null | undefined,
): number | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isNaN(ms) ? null : ms;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

/**
 * The minimal shape of a cloud `task.list` row the unified layer reads. Declared
 * structurally so this module carries NO `@superset/db` dependency; the cloud
 * adapter passes the `api.task.list` rows verbatim.
 */
export interface CloudTaskListRow {
	task: {
		id: string;
		slug: string;
		title: string;
		description: string | null;
		priority: string | null;
		externalProvider: string | null;
		externalKey: string | null;
		externalUrl: string | null;
		createdAt: Date | string | number | null;
		updatedAt: Date | string | number | null;
	};
	assignee?: { name: string | null } | null;
	statusName?: string | null;
}

/** Map a cloud Linear-synced `tasks` row → unified ticket (`source: "cloud"`). */
export function mapCloudTaskToUnified(row: CloudTaskListRow): UnifiedTicket {
	const { task } = row;
	return {
		unifiedId: makeUnifiedTicketId({ source: "cloud", sourceId: task.id }),
		source: "cloud",
		// The cloud task id is the writeback handle (`ctx.api.task.update`).
		sourceId: task.id,
		identifier: task.externalKey ?? task.slug,
		title: task.title,
		description: task.description ?? null,
		url: task.externalUrl ?? null,
		priority: toPriorityLabel(task.priority),
		state: { name: row.statusName ?? null },
		assignee: row.assignee ? { name: row.assignee.name ?? null } : null,
		// Cloud `tasks` carry no team in the list shape (v1).
		team: null,
		createdAt: toEpochMs(task.createdAt),
		updatedAt: toEpochMs(task.updatedAt),
	};
}

/** Map a host-local Linear ticket (M2) → unified ticket (`source: "local"`). */
export function mapLocalTicketToUnified(
	ticket: LocalLinearTicket,
): UnifiedTicket {
	return {
		unifiedId: makeUnifiedTicketId({ source: "local", sourceId: ticket.id }),
		source: "local",
		// The Linear issue id is the writeback handle (direct Linear API).
		sourceId: ticket.id,
		identifier: ticket.identifier,
		title: ticket.title,
		description: ticket.description ?? null,
		url: ticket.url ?? null,
		priority: toPriorityLabel(ticket.priorityLabel),
		state: { name: ticket.state.name ?? null },
		assignee: ticket.assignee ? { name: ticket.assignee.name ?? null } : null,
		team: ticket.team
			? { key: ticket.team.key ?? null, name: ticket.team.name ?? null }
			: null,
		createdAt: ticket.createdAt ?? null,
		updatedAt: ticket.updatedAt ?? null,
	};
}
