import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { LocalLinearTicket } from "../../../runtime/linear-tickets";
import { protectedProcedure, router } from "../../index";

// Wave-7 M2 — host-local Linear tickets (`linear.tickets.*`). Streams the
// viewer's locally-fetched issues to the renderer. The renderer's host-service
// tRPC client is httpLink-only (no subscriptions), so it reads via `list`
// (with a refetch interval) + `refresh`; `onChange` is the host-side observable
// streaming primitive (mirrors `terminalAgents.onWorkspaceChange`) that M3 can
// bridge. NO procedure here touches the cloud DB or returns token material.

const listInput = z
	.object({
		teamId: z.string().optional(),
	})
	.optional();

type TicketsSnapshot = {
	kind: "snapshot" | "change";
	tickets: LocalLinearTicket[];
};

export const ticketsRouter = router({
	/** Cached local tickets, optionally narrowed to a team. */
	list: protectedProcedure.input(listInput).query(({ ctx, input }) => {
		return ctx.runtime.linearTickets.list({ teamId: input?.teamId });
	}),

	/** Teams for the picker (fetched with the local token; `[]` if disconnected). */
	teams: protectedProcedure.query(({ ctx }) => {
		return ctx.runtime.linearTickets.getTeams();
	}),

	/** Manual Refresh — poll Linear now and upsert. No-op without a local token. */
	refresh: protectedProcedure.mutation(({ ctx }) => {
		return ctx.runtime.linearTickets.refresh();
	}),

	/** Snapshot-then-deltas stream of cached tickets (observable, host-side). */
	onChange: protectedProcedure.subscription(({ ctx }) => {
		return observable<TicketsSnapshot>((emit) => {
			const snapshot = () => ctx.runtime.linearTickets.list();
			emit.next({ kind: "snapshot", tickets: snapshot() });
			const unsubscribe = ctx.runtime.linearTickets.onChange(() => {
				emit.next({ kind: "change", tickets: snapshot() });
			});
			return unsubscribe;
		});
	}),
});
