import { z } from "zod";

export const ticketPlanScopeSchema = z.object({
	taskId: z.string().min(1),
	unifiedId: z.string().min(1).optional(),
	ticketKey: z.string().min(1),
	repos: z
		.array(
			z.object({
				projectId: z.string().min(1),
				baseBranch: z.string().min(1).optional(),
			}),
		)
		.min(1),
	approvedContextProjectId: z.string().min(1),
	executorAgent: z.enum(["claude", "codex"]).default("claude"),
});
export type TicketPlanScope = z.infer<typeof ticketPlanScopeSchema>;
export const planRecordSchema = z.object({
	id: z.string().uuid(),
	scope: ticketPlanScopeSchema,
	snapshotHash: z.string(),
	plan: z.string(),
	state: z.enum([
		"planning",
		"reviewing",
		"approved",
		"revise",
		"escalated",
		"consumed",
	]),
	feedback: z.array(z.string()),
	plannerSessionId: z.string().nullable(),
	reviewerSessionId: z.string().nullable(),
	reviewAttempts: z.number().int(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type TicketPlanRecord = z.infer<typeof planRecordSchema>;
export interface TicketPlanSnapshot {
	hash: string;
	context: string;
	cwd: string;
	repositories: { projectId: string; path: string; head: string }[];
}
