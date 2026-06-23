import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import {
	approvedTicketContext,
	projects,
	ticketRuns,
} from "../../../db/schema";
import { MemoryRetrieveService } from "../../../runtime/memory/retrieve-service.ts";
import type { HostServiceContext } from "../../../types";
import { ticketRunRouter } from "./ticket-run.ts";

/**
 * B5 router contract: `ticketRun.start` is the host entrypoint the desktop UI
 * (tickets' B4) calls. The runtime orchestrator (`dispatchTicketRun`) is covered
 * by `runtime/ticket-runs/dispatch.test.ts`; THIS test covers the router's own
 * boundary behavior that the runtime test cannot — the translation of the
 * runtime's `TicketContextNotApprovedError` into a tRPC `PRECONDITION_FAILED`
 * error (the single human-gate precondition: a context must be approved first).
 */

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("ticketRun router (B5 entrypoint)", () => {
	let db: HostDb;
	const taskId = "22222222-2222-4222-8222-222222222222";
	const projectId = "projA";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/a" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		const ctx = {
			db,
			isAuthenticated: true,
			runtime: { memoryRetrieve: new MemoryRetrieveService({ db }) },
		} as unknown as HostServiceContext;
		return ticketRunRouter.createCaller(ctx);
	}

	it("maps a missing approved context to PRECONDITION_FAILED", async () => {
		// No approvedTicketContext row was seeded → the gate must reject.
		const promise = caller().start({
			taskId,
			ticketKey: "SUPER-1",
			repos: [{ projectId }],
			approvedContextProjectId: projectId,
		});
		await expect(promise).rejects.toBeInstanceOf(TRPCError);
		await expect(promise).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		// The precondition fails before any run row is created.
		expect(db.select().from(ticketRuns).all().length).toBe(0);
	});

	it("succeeds (PRECONDITION met) once a context is approved, recording a run row", async () => {
		db.insert(approvedTicketContext)
			.values({
				id: crypto.randomUUID(),
				projectId,
				taskId,
				content: "approved work",
			})
			.run();

		// Inject a createWorkspace via the runtime path: the router builds its own
		// from ctx, but the not-approved precondition is now satisfied, so dispatch
		// proceeds and records a run row per repo. We assert the gate is passed and
		// a row is produced (the orchestrator lifecycle itself is covered in
		// dispatch.test.ts); a thrown launch is recorded on the row, not surfaced.
		const result = await caller().start({
			taskId,
			ticketKey: "SUPER-1",
			repos: [{ projectId }],
			approvedContextProjectId: projectId,
		});

		expect(result.runs.length).toBe(1);
		expect(db.select().from(ticketRuns).all().length).toBe(1);
	});
});
