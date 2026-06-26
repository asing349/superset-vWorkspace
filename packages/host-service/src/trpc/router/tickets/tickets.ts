import { z } from "zod";
import type { ResolvedTickets, TicketSource } from "../../../runtime/tickets";
import { protectedProcedure, router } from "../../index";

// Wave-7 M3 — source-agnostic ticket surface (`tickets.*`). At read time it
// resolves THE SINGLE ACTIVE SOURCE under cloud-precedence (cloud Linear-synced
// `tasks` when a cloud connection is active, else the host-local Linear cache,
// else nothing) and returns one unified, `source`-tagged DTO. The renderer
// ticket list reads this and badges each row; M4 swaps the wave-4 ticket→PR
// pipeline onto it. Read-time composition only — nothing here persists, and the
// local source is never written into the cloud `tasks` table.

const listInput = z
	.object({
		/** Narrow LOCAL tickets to a Linear team id. Ignored for the cloud source. */
		teamId: z.string().optional(),
	})
	.optional();

export const ticketsRouter = router({
	/**
	 * The active source's unified tickets, source-tagged. `source` is `null` only
	 * when neither a cloud nor a local Linear connection is active.
	 */
	list: protectedProcedure
		.input(listInput)
		.query(({ ctx, input }): Promise<ResolvedTickets> => {
			return ctx.runtime.tickets.list({ teamId: input?.teamId });
		}),

	/**
	 * The currently-active source (`"cloud"` | `"local"` | `null`) WITHOUT
	 * fetching tickets — a cheap status check for the UI badge/affordances.
	 */
	activeSource: protectedProcedure.query(
		({ ctx }): Promise<TicketSource | null> => {
			return ctx.runtime.tickets.activeSource();
		},
	),
});
