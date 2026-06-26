// Wave-7 M3 — pure label helper for the source badge on the source-agnostic
// ticket list. The unified `tickets.list` tags each ticket (and the resolved
// active source) with `"cloud"` | `"local"`; the UI badges it human-readably.

export type TicketSource = "cloud" | "local";

/** Human-readable badge label for a ticket source. */
export function ticketSourceLabel(source: TicketSource): string {
	return source === "cloud" ? "Cloud" : "This Mac";
}
