import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { readTicketPlanSnapshot } from "../../../runtime/ticket-plans/snapshot";
import { ticketPlanScopeSchema } from "../../../runtime/ticket-plans/types";
import { protectedProcedure, router } from "../../index";

export const ticketPlanRouter = router({
	prepare: protectedProcedure
		.input(ticketPlanScopeSchema)
		.mutation(async ({ ctx, input }) => {
			const account = await ctx.runtime.codex.status();
			if (
				!account.connected ||
				!["chatgpt", "apiKey"].includes(account.authMethod ?? "")
			)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						account.error ??
						"Connect Codex in Settings → Integrations before preparing a plan.",
				});
			return ctx.runtime.ticketPlans.prepare(
				input,
				await readTicketPlanSnapshot(ctx.db, input),
			);
		}),
	review: protectedProcedure
		.input(
			z.object({
				planId: z.string().uuid(),
				plan: z.string().trim().min(1).max(100_000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const record = ctx.runtime.ticketPlans.get(input.planId);
			return ctx.runtime.ticketPlans.review(
				input.planId,
				input.plan,
				await readTicketPlanSnapshot(ctx.db, record.scope),
			);
		}),
	get: protectedProcedure
		.input(z.object({ planId: z.string().uuid() }))
		.query(({ ctx, input }) => ctx.runtime.ticketPlans.get(input.planId)),
});
