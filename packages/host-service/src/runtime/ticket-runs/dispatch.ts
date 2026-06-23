import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { approvedTicketContext, ticketRuns } from "../../db/schema.ts";
import type { MemoryRetrieveService } from "../memory/retrieve-service.ts";
import { assembleTicketPrompt } from "./assemble-prompt.ts";

/**
 * Ticket→PR orchestrator core (B5), modeled on `dispatchAutomation`'s
 * structure: read the approved context (the single human gate's output) → per
 * repo, insert a `dispatching` run row → create the worktree-on-new-branch +
 * launch the headless agent → advance the row to `dispatched` (or `failed`).
 *
 * Runs HOST-SIDE and IN-PROCESS — the `createWorkspace` callback wraps the host
 * `workspaces.create` new-branch path (worktree from base + `agents[]`), so we
 * write NO new git/clone/worktree code. The callback is injected so tests fake
 * it (never spawning real agents or opening real PRs).
 *
 * HARD GUARDRAIL: autonomous to PR CREATION ONLY. This module NEVER invokes any
 * merge tool, and the assembled prompt forbids merging.
 */

export type TicketRunStatus = "dispatching" | "dispatched" | "failed";

export interface TicketRunRepoInput {
	projectId: string;
	baseBranch?: string;
}

export interface DispatchTicketRunInput {
	/** Cloud task id (Linear-synced `tasks.id`). */
	taskId: string;
	/** Ticket key (e.g. "SUPER-172"), carried into branch/PR for B6 linking. */
	ticketKey: string;
	/** One entry per repo the run touches (single by default; N for multi-repo). */
	repos: TicketRunRepoInput[];
	/** The projectId the approved context was stored under (B3 store key). */
	approvedContextProjectId: string;
}

/** The subset of the host `workspaces.create` result the orchestrator records. */
export interface CreatedWorkspace {
	workspaceId: string;
	branch: string | null;
}

/**
 * Injected worktree+agent launcher. In production this wraps
 * `workspacesRouter.createCaller(ctx).create(...)` (the new-branch-from-base
 * path with `agents:[{ agent:"claude", prompt }]`); in tests it is faked.
 */
export type CreateWorkspaceFn = (args: {
	projectId: string;
	baseBranch?: string;
	taskId: string;
	prompt: string;
}) => Promise<CreatedWorkspace>;

export interface TicketRunResult {
	runId: string;
	projectId: string;
	status: TicketRunStatus;
	workspaceId: string | null;
	branch: string | null;
	error: string | null;
}

export interface DispatchTicketRunResult {
	runs: TicketRunResult[];
}

/** Thrown when no approved context exists for the ticket (must approve first). */
export class TicketContextNotApprovedError extends Error {
	constructor(options: { taskId: string; approvedContextProjectId: string }) {
		super(
			`No approved context for task "${options.taskId}" in project "${options.approvedContextProjectId}". Approve the ticket context before starting a run.`,
		);
		this.name = "TicketContextNotApprovedError";
	}
}

function readApprovedContext(
	db: HostDb,
	options: { projectId: string; taskId: string },
): string | null {
	const row = db
		.select({ content: approvedTicketContext.content })
		.from(approvedTicketContext)
		.where(
			and(
				eq(approvedTicketContext.projectId, options.projectId),
				eq(approvedTicketContext.taskId, options.taskId),
			),
		)
		.get();
	return row?.content ?? null;
}

/**
 * Dispatch a ticket→PR run across one or more repos. Per repo:
 *   1. assemble the layered, redacted prompt (global < project < approved),
 *   2. insert a `dispatching` run row,
 *   3. call `createWorkspace` (worktree + headless agent),
 *   4. advance the row to `dispatched` or `failed`.
 * A failure on one repo is recorded on its row and does NOT abort the others.
 */
export async function dispatchTicketRun(options: {
	db: HostDb;
	retrieve: MemoryRetrieveService;
	input: DispatchTicketRunInput;
	createWorkspace: CreateWorkspaceFn;
	now?: () => number;
}): Promise<DispatchTicketRunResult> {
	const { db, retrieve, input, createWorkspace } = options;
	const now = options.now ?? Date.now;

	// (a) The approved context is mandatory — it is the authoritative top layer.
	const approvedContext = readApprovedContext(db, {
		projectId: input.approvedContextProjectId,
		taskId: input.taskId,
	});
	if (approvedContext === null) {
		throw new TicketContextNotApprovedError({
			taskId: input.taskId,
			approvedContextProjectId: input.approvedContextProjectId,
		});
	}

	// Global practice is repo-independent; read it once.
	const globalPractice =
		retrieve.readPracticeVersion({ scope: "global", projectId: null })
			?.content ?? null;

	const runs: TicketRunResult[] = [];

	for (const repo of input.repos) {
		// (b) Project practice is per-repo; assemble the layered, redacted prompt.
		const projectPractice =
			retrieve.readPracticeVersion({
				scope: "project",
				projectId: repo.projectId,
			})?.content ?? null;

		const prompt = assembleTicketPrompt({
			ticketKey: input.ticketKey,
			globalPractice,
			projectPractice,
			approvedContext,
		});

		// (c) Insert the run row BEFORE dispatch so a crash leaves a recoverable
		// `dispatching` row (mirrors `dispatchAutomation`).
		const runId = randomUUID();
		const insertedAt = now();
		db.insert(ticketRuns)
			.values({
				id: runId,
				taskId: input.taskId,
				projectId: repo.projectId,
				status: "dispatching",
				createdAt: insertedAt,
				updatedAt: insertedAt,
			})
			.run();

		try {
			const created = await createWorkspace({
				projectId: repo.projectId,
				baseBranch: repo.baseBranch,
				taskId: input.taskId,
				prompt,
			});

			db.update(ticketRuns)
				.set({
					status: "dispatched",
					workspaceId: created.workspaceId,
					branch: created.branch,
					updatedAt: now(),
				})
				.where(eq(ticketRuns.id, runId))
				.run();

			runs.push({
				runId,
				projectId: repo.projectId,
				status: "dispatched",
				workspaceId: created.workspaceId,
				branch: created.branch,
				error: null,
			});
		} catch (err) {
			// Per-repo failure: record it on THIS row and keep going (a later repo
			// is unaffected; a partial multi-repo run is recorded, not thrown).
			const error = err instanceof Error ? err.message : String(err);
			db.update(ticketRuns)
				.set({ status: "failed", error, updatedAt: now() })
				.where(eq(ticketRuns.id, runId))
				.run();

			runs.push({
				runId,
				projectId: repo.projectId,
				status: "failed",
				workspaceId: null,
				branch: null,
				error,
			});
		}
	}

	return { runs };
}
