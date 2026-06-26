import type { ApiClient } from "../../types";
import { mapCloudTaskToUnified } from "./mappers";
import type { UnifiedTicket } from "./types";

// Wave-7 M3 — cloud ticket source adapter. Reads the cloud `tasks` (the existing
// org-scoped, Linear-synced rows) via the host cloud API client at READ TIME and
// normalizes them into unified tickets. NOTHING is written: this is a pure read
// over the frozen cloud schema. Only Linear-synced tasks
// (`externalProvider === "linear"`) are surfaced — local-only cloud tasks and
// other providers are filtered out.

// The cloud `task.list` schema caps `limit` at 500; v1 surfaces a single page.
const CLOUD_TASK_PAGE_LIMIT = 500;

export interface FetchCloudTicketsDeps {
	/** Host cloud API client (org+user scoped already). */
	api: ApiClient;
}

/**
 * Fetch the cloud Linear-synced tasks and map them into unified tickets. The
 * host api client is already scoped to the active org/user, so no org id is
 * passed (mirrors `pr-loop-reconciler`'s `api.task.statuses.list` usage).
 */
export async function fetchCloudTickets({
	api,
}: FetchCloudTicketsDeps): Promise<UnifiedTicket[]> {
	const rows = await api.task.list.query({ limit: CLOUD_TASK_PAGE_LIMIT });
	return rows
		.filter((row) => row.task.externalProvider === "linear")
		.map(mapCloudTaskToUnified);
}
