import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import { approvedTicketContext, projects } from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { ticketContextRouter } from "./ticket-context.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

/**
 * Build a fresh in-memory db and apply ALL migrations — this also proves the
 * 0008_ticket_context migration applies cleanly to a fresh db.
 */
function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

describe("ticketContextRouter (B3-host)", () => {
	let db: HostDb;
	const projectId = "project-1";
	const taskId = "SUPER-172"; // cloud task id (Linear-synced), no FK

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		const ctx = {
			db,
			isAuthenticated: true,
		} as unknown as HostServiceContext;
		return ticketContextRouter.createCaller(ctx);
	}

	function countRows(): number {
		return db.select().from(approvedTicketContext).all().length;
	}

	it("returns null when no context has been approved for the key", async () => {
		const c = caller();
		expect(await c.getApproved({ projectId, taskId })).toBeNull();
	});

	it("saves an approved context and getApproved returns it", async () => {
		const c = caller();
		await c.saveApproved({
			projectId,
			taskId,
			content: "# Approved\n\nDo the thing.",
			approvedBy: "ajit",
		});
		expect(await c.getApproved({ projectId, taskId })).toBe(
			"# Approved\n\nDo the thing.",
		);
		expect(countRows()).toBe(1);
	});

	it("upsert keyed (projectId, taskId) REPLACES, not duplicates", async () => {
		const c = caller();
		await c.saveApproved({ projectId, taskId, content: "first version" });
		await c.saveApproved({ projectId, taskId, content: "second version" });

		// Same key → one row, latest content.
		expect(countRows()).toBe(1);
		expect(await c.getApproved({ projectId, taskId })).toBe("second version");

		// A different taskId for the same project is a DISTINCT row.
		await c.saveApproved({ projectId, taskId: "SUPER-999", content: "other" });
		expect(countRows()).toBe(2);
		expect(await c.getApproved({ projectId, taskId })).toBe("second version");
		expect(await c.getApproved({ projectId, taskId: "SUPER-999" })).toBe(
			"other",
		);
	});

	it("redacts a planted secret on save (redaction point #1)", async () => {
		const c = caller();
		const secret = `ghp_${"a".repeat(36)}`;
		await c.saveApproved({
			projectId,
			taskId,
			content: `Use this token: ${secret} to push.`,
		});

		const stored = await c.getApproved({ projectId, taskId });
		expect(stored).not.toBeNull();
		expect(stored).not.toContain(secret);
		expect(stored).toContain("[REDACTED]");
		// Surrounding prose is preserved.
		expect(stored).toContain("to push.");
	});
});
