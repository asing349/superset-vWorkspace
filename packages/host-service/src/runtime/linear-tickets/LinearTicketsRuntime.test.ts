import { Database as BunDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import type { LinearTicketClient } from "./client";
import {
	LinearTicketsRuntime,
	type TicketAuthTokenSource,
} from "./LinearTicketsRuntime";
import { LinearTicketsStore } from "./store";
import type { LinearIssue, LinearTeam, TicketFilter } from "./types";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

interface TestDb {
	db: HostDb;
	close: () => void;
}

function makeTestDb(): TestDb {
	const dir = mkdtempSync(join(tmpdir(), "linear-tickets-rt-"));
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
		id: "issue-1",
		identifier: "ENG-1",
		title: "Do the work",
		description: null,
		url: "https://linear.app/acme/issue/ENG-1",
		priority: 3,
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-02T00:00:00.000Z",
		assignee: null,
		state: null,
		team: { id: "team-1", key: "ENG", name: "Engineering" },
		...overrides,
	};
}

/** A token source whose token can be toggled (null = disconnected). */
class FakeAuth implements TicketAuthTokenSource {
	constructor(private token: string | null) {}
	getAccessToken(): string | null {
		return this.token;
	}
	set(token: string | null): void {
		this.token = token;
	}
}

/** A fake Linear client that records calls and returns canned data. */
class FakeClient implements LinearTicketClient {
	issuesCalls = 0;
	teamsCalls = 0;
	constructor(
		private readonly issues: LinearIssue[],
		private readonly teams: LinearTeam[] = [],
	) {}
	fetchIssues(_filter: TicketFilter): Promise<LinearIssue[]> {
		this.issuesCalls += 1;
		return Promise.resolve(this.issues);
	}
	fetchTeams(): Promise<LinearTeam[]> {
		this.teamsCalls += 1;
		return Promise.resolve(this.teams);
	}
}

describe("LinearTicketsRuntime", () => {
	let harness: TestDb;
	let store: LinearTicketsStore;

	beforeEach(() => {
		harness = makeTestDb();
		store = new LinearTicketsStore({ db: harness.db });
	});

	afterEach(() => {
		harness.close();
	});

	it("polls and upserts the viewer's issues when a token is present", async () => {
		const client = new FakeClient([makeIssue()]);
		let factoryCalls = 0;
		const runtime = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth("tok-abc"),
			createClient: ({ accessToken }) => {
				factoryCalls += 1;
				expect(accessToken).toBe("tok-abc");
				return client;
			},
			now: () => 5_000,
		});

		const result = await runtime.poll();
		expect(result).toEqual({ polled: true, count: 1 });
		expect(factoryCalls).toBe(1);
		expect(client.issuesCalls).toBe(1);

		const tickets = runtime.list();
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.identifier).toBe("ENG-1");
		expect(tickets[0]?.syncedAt).toBe(5_000);
	});

	it("is a strict no-op when there is no local token", async () => {
		let factoryCalls = 0;
		const runtime = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth(null),
			createClient: () => {
				factoryCalls += 1;
				throw new Error("client must not be built without a token");
			},
		});

		const result = await runtime.poll();
		expect(result).toEqual({ polled: false, count: 0 });
		expect(factoryCalls).toBe(0);
		expect(runtime.list()).toEqual([]);
	});

	it("refresh() re-polls idempotently (no duplicate rows)", async () => {
		const client = new FakeClient([makeIssue()]);
		const runtime = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth("tok-abc"),
			createClient: () => client,
			now: () => 1,
		});

		await runtime.refresh();
		await runtime.refresh();
		expect(client.issuesCalls).toBe(2);
		expect(runtime.list()).toHaveLength(1);
		expect(store.count()).toBe(1);
	});

	it("emits a change event after a successful poll", async () => {
		const client = new FakeClient([makeIssue()]);
		const runtime = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth("tok-abc"),
			createClient: () => client,
		});

		let changes = 0;
		const unsubscribe = runtime.onChange(() => {
			changes += 1;
		});
		await runtime.poll();
		expect(changes).toBe(1);

		unsubscribe();
		await runtime.poll();
		expect(changes).toBe(1);
	});

	it("runs ensureFreshToken before reading the token", async () => {
		const auth = new FakeAuth(null);
		const client = new FakeClient([makeIssue()]);
		const runtime = new LinearTicketsRuntime({
			store,
			auth,
			createClient: () => client,
			// Simulate a refresh that re-establishes the token before the poll.
			ensureFreshToken: async () => {
				auth.set("tok-refreshed");
			},
		});

		const result = await runtime.poll();
		expect(result).toEqual({ polled: true, count: 1 });
		expect(client.issuesCalls).toBe(1);
	});

	it("getTeams returns the team shape, or [] without a token", async () => {
		const teams: LinearTeam[] = [{ id: "team-1", key: "ENG", name: "Eng" }];
		const client = new FakeClient([], teams);

		const connected = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth("tok-abc"),
			createClient: () => client,
		});
		expect(await connected.getTeams()).toEqual(teams);
		expect(client.teamsCalls).toBe(1);

		const disconnected = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth(null),
			createClient: () => {
				throw new Error("client must not be built without a token");
			},
		});
		expect(await disconnected.getTeams()).toEqual([]);
	});

	it("coalesces concurrent polls into one fetch", async () => {
		const client = new FakeClient([makeIssue()]);
		const runtime = new LinearTicketsRuntime({
			store,
			auth: new FakeAuth("tok-abc"),
			createClient: () => client,
		});

		const [a, b] = await Promise.all([runtime.poll(), runtime.poll()]);
		expect(a).toEqual(b);
		expect(client.issuesCalls).toBe(1);
	});
});
