import { Database as BunDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import { LinearTicketsStore } from "./store";
import type { LinearIssue } from "./types";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

interface TestDb {
	db: HostDb;
	close: () => void;
}

function makeTestDb(): TestDb {
	const dir = mkdtempSync(join(tmpdir(), "linear-tickets-test-"));
	const dbPath = join(dir, "host.db");
	const sqlite = new BunDatabase(dbPath, { create: true, readwrite: true });
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return {
		db: db as unknown as HostDb,
		close: () => {
			try {
				sqlite.close();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
	return {
		id: "issue-uuid-1",
		identifier: "ENG-123",
		title: "Fix the thing",
		description: "Some details",
		url: "https://linear.app/acme/issue/ENG-123",
		priority: 2,
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-20T00:00:00.000Z",
		assignee: { id: "user-1", name: "Ada", email: "ada@example.com" },
		state: { id: "state-1", name: "In Progress", type: "started" },
		team: { id: "team-1", key: "ENG", name: "Engineering" },
		...overrides,
	};
}

describe("LinearTicketsStore", () => {
	let harness: TestDb;
	let store: LinearTicketsStore;

	beforeEach(() => {
		harness = makeTestDb();
		store = new LinearTicketsStore({ db: harness.db });
	});

	afterEach(() => {
		harness.close();
	});

	it("maps an upserted issue into a renderer ticket", () => {
		const count = store.upsertMany({ issues: [makeIssue()], now: 1_000 });
		expect(count).toBe(1);

		const tickets = store.list();
		expect(tickets).toHaveLength(1);
		const ticket = tickets[0];
		expect(ticket).toBeDefined();
		if (!ticket) return;
		expect(ticket.id).toBe("issue-uuid-1");
		expect(ticket.identifier).toBe("ENG-123");
		expect(ticket.title).toBe("Fix the thing");
		expect(ticket.url).toBe("https://linear.app/acme/issue/ENG-123");
		expect(ticket.priority).toBe(2);
		expect(ticket.priorityLabel).toBe("high");
		expect(ticket.state).toEqual({
			id: "state-1",
			name: "In Progress",
			type: "started",
		});
		expect(ticket.assignee).toEqual({
			id: "user-1",
			name: "Ada",
			email: "ada@example.com",
		});
		expect(ticket.team).toEqual({
			id: "team-1",
			key: "ENG",
			name: "Engineering",
		});
		expect(ticket.createdAt).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
		expect(ticket.updatedAt).toBe(Date.parse("2026-06-20T00:00:00.000Z"));
		expect(ticket.syncedAt).toBe(1_000);
	});

	it("is idempotent on re-upsert (no duplicates; updates in place)", () => {
		store.upsertMany({ issues: [makeIssue()], now: 1_000 });
		store.upsertMany({
			issues: [makeIssue({ title: "Renamed", priority: 1 })],
			now: 2_000,
		});

		const tickets = store.list();
		expect(tickets).toHaveLength(1);
		expect(store.count()).toBe(1);
		const ticket = tickets[0];
		expect(ticket?.title).toBe("Renamed");
		expect(ticket?.priority).toBe(1);
		expect(ticket?.priorityLabel).toBe("urgent");
		expect(ticket?.syncedAt).toBe(2_000);
	});

	it("filters by team and orders by updatedAt desc", () => {
		store.upsertMany({
			issues: [
				makeIssue({
					id: "a",
					identifier: "ENG-1",
					updatedAt: "2026-06-10T00:00:00.000Z",
					team: { id: "team-1", key: "ENG", name: "Engineering" },
				}),
				makeIssue({
					id: "b",
					identifier: "ENG-2",
					updatedAt: "2026-06-25T00:00:00.000Z",
					team: { id: "team-1", key: "ENG", name: "Engineering" },
				}),
				makeIssue({
					id: "c",
					identifier: "DES-1",
					updatedAt: "2026-06-30T00:00:00.000Z",
					team: { id: "team-2", key: "DES", name: "Design" },
				}),
			],
			now: 1_000,
		});

		const all = store.list();
		expect(all.map((t) => t.identifier)).toEqual(["DES-1", "ENG-2", "ENG-1"]);

		const eng = store.list({ teamId: "team-1" });
		expect(eng.map((t) => t.identifier)).toEqual(["ENG-2", "ENG-1"]);
	});

	it("handles issues with missing assignee/state/team", () => {
		store.upsertMany({
			issues: [
				makeIssue({
					id: "bare",
					assignee: null,
					state: null,
					team: null,
				}),
			],
			now: 1_000,
		});
		const ticket = store.list()[0];
		expect(ticket?.assignee).toBeNull();
		expect(ticket?.team).toBeNull();
		expect(ticket?.state).toEqual({ id: null, name: null, type: null });
	});

	it("clear() purges the cache", () => {
		store.upsertMany({ issues: [makeIssue()], now: 1_000 });
		expect(store.count()).toBe(1);
		store.clear();
		expect(store.count()).toBe(0);
		expect(store.list()).toEqual([]);
	});
});
