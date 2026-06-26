import { desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db";
import { linearTickets } from "../../db/schema";
import { mapIssueToRow, mapRowToTicket } from "./mappers";
import type { LinearIssue, LocalLinearTicket, TicketFilter } from "./types";

// Wave-7 M2 — host-local cache of the viewer's Linear issues. Keyed on the
// stable Linear issue UUID (`id`); the poller upserts so re-polling is
// idempotent (never duplicates). Safe to `clear()` and re-poll. Host SQLite is
// synchronous (`.get()`/`.all()`/`.run()`), so all ops here are synchronous.

export class LinearTicketsStore {
	private readonly db: HostDb;

	constructor({ db }: { db: HostDb }) {
		this.db = db;
	}

	/**
	 * Upsert the fetched issues. Idempotent on the issue id — a re-poll updates
	 * the existing row in place rather than inserting a duplicate. Returns the
	 * number of issues processed.
	 */
	upsertMany({ issues, now }: { issues: LinearIssue[]; now: number }): number {
		for (const issue of issues) {
			const row = mapIssueToRow({ issue, now });
			// Re-derive the mutable set so an existing row is fully overwritten.
			const { id: _id, ...mutable } = row;
			this.db
				.insert(linearTickets)
				.values(row)
				.onConflictDoUpdate({ target: linearTickets.id, set: mutable })
				.run();
		}
		return issues.length;
	}

	/** List stored tickets (most-recently-updated first), optional team filter. */
	list({ teamId }: TicketFilter = {}): LocalLinearTicket[] {
		const base = this.db.select().from(linearTickets);
		const rows = teamId
			? base
					.where(eq(linearTickets.teamId, teamId))
					.orderBy(desc(linearTickets.issueUpdatedAt))
					.all()
			: base.orderBy(desc(linearTickets.issueUpdatedAt)).all();
		return rows.map(mapRowToTicket);
	}

	/** Total number of cached tickets. */
	count(): number {
		return this.db.select().from(linearTickets).all().length;
	}

	/** Purge all cached tickets (e.g. on disconnect). */
	clear(): void {
		this.db.delete(linearTickets).run();
	}
}
