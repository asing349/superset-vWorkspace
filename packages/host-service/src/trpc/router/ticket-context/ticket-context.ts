import { randomUUID } from "node:crypto";
import { redactText } from "@superset/memory";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../db";
import { approvedTicketContext } from "../../../db/schema";
import { protectedProcedure, queryProcedure, router } from "../../index";

/**
 * `ticketContext` router (Wave 4, Part B — B3-host). The local, host-side store
 * for the developer-APPROVED ticket context: the output of the single human
 * gate, and the TOP-precedence layer assembled for the autonomous run
 * (developer-approved > project practice > global practice).
 *
 * Keyed `(projectId, taskId)` where `taskId` is the CLOUD task id (Linear-
 * synced `tasks.id`). Stored host-side only — the cloud schema stays frozen
 * (carries wave-3's local-only discipline; no `packages/db` / cloud `tasks`
 * change). The approved content is REDACTED before persistence (redaction
 * point #1).
 */

/** Read the stored approved-context row for a `(projectId, taskId)` pair. */
function getRow(
	db: HostDb,
	options: { projectId: string; taskId: string },
): typeof approvedTicketContext.$inferSelect | undefined {
	return db
		.select()
		.from(approvedTicketContext)
		.where(
			and(
				eq(approvedTicketContext.projectId, options.projectId),
				eq(approvedTicketContext.taskId, options.taskId),
			),
		)
		.get();
}

export const ticketContextRouter = router({
	/**
	 * Return the approved context Markdown for a ticket, or `null` when none has
	 * been approved yet for this `(projectId, taskId)`.
	 */
	getApproved: queryProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				taskId: z.string().min(1),
			}),
		)
		.query(({ ctx, input }): string | null => {
			const row = getRow(ctx.db, {
				projectId: input.projectId,
				taskId: input.taskId,
			});
			return row?.content ?? null;
		}),

	/**
	 * Upsert the approved context for a ticket, keyed `(projectId, taskId)`. The
	 * `content` is REDACTED (best-effort secret-scrub) BEFORE it is persisted —
	 * this is redaction point #1, run on the authoritative approved context
	 * before it ever reaches disk. Re-approving the same ticket REPLACES the row
	 * (never duplicates), via the unique `(project_id, task_id)` index.
	 */
	saveApproved: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				taskId: z.string().min(1),
				content: z.string(),
				approvedBy: z.string().nullable().default(null),
			}),
		)
		.mutation(({ ctx, input }): { id: string; content: string } => {
			// Redaction point #1: scrub the approved Markdown before persisting.
			// `content` is a single string, so use `redactText().text` (this is the
			// same per-value scrub `redactAll` applies element-wise to an array).
			const redacted = redactText(input.content).text;
			const now = Date.now();

			const existing = getRow(ctx.db, {
				projectId: input.projectId,
				taskId: input.taskId,
			});

			if (existing) {
				ctx.db
					.update(approvedTicketContext)
					.set({
						content: redacted,
						approvedBy: input.approvedBy,
						updatedAt: now,
					})
					.where(eq(approvedTicketContext.id, existing.id))
					.run();
				return { id: existing.id, content: redacted };
			}

			const id = randomUUID();
			ctx.db
				.insert(approvedTicketContext)
				.values({
					id,
					projectId: input.projectId,
					taskId: input.taskId,
					content: redacted,
					approvedBy: input.approvedBy,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			return { id, content: redacted };
		}),
});
