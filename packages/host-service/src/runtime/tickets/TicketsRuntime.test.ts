import { describe, expect, it } from "bun:test";
import type { ApiClient } from "../../types";
import type { LocalLinearTicket } from "../linear-tickets";
import { fetchCloudTickets } from "./cloud-source";
import { mapLocalTicketToUnified } from "./mappers";
import { TicketsRuntime } from "./TicketsRuntime";

// Wave-7 M3 — end-to-end test of the runtime wired exactly as `app.ts` wires it:
// cloud via `fetchCloudTickets` over a FAKE cloud API client, local via the M2
// store's `LocalLinearTicket`s mapped through `mapLocalTicketToUnified`. No live
// cloud API and no real store — both sources are injected fakes.

interface FakeTaskRow {
	task: {
		id: string;
		slug: string;
		title: string;
		description: string | null;
		priority: string | null;
		externalProvider: string | null;
		externalKey: string | null;
		externalUrl: string | null;
		createdAt: Date | null;
		updatedAt: Date | null;
	};
	assignee: { name: string | null } | null;
	statusName: string | null;
}

function cloudRow(id: string, externalKey: string): FakeTaskRow {
	return {
		task: {
			id,
			slug: id,
			title: `cloud ${id}`,
			description: null,
			priority: "high",
			externalProvider: "linear",
			externalKey,
			externalUrl: `https://linear.app/acme/issue/${externalKey}`,
			createdAt: new Date("2026-06-01T00:00:00.000Z"),
			updatedAt: new Date("2026-06-02T00:00:00.000Z"),
		},
		assignee: null,
		statusName: "Todo",
	};
}

function fakeApi(rows: FakeTaskRow[]): ApiClient {
	return {
		task: { list: { query: async () => rows } },
	} as unknown as ApiClient;
}

function localTicket(id: string, identifier: string): LocalLinearTicket {
	return {
		id,
		identifier,
		title: `local ${id}`,
		description: null,
		url: `https://linear.app/acme/issue/${identifier}`,
		priority: 0,
		priorityLabel: "none",
		state: { id: null, name: "Backlog", type: "backlog" },
		assignee: null,
		team: { id: "team-1", key: "ENG", name: "Engineering" },
		createdAt: null,
		updatedAt: null,
		syncedAt: 1_000,
	};
}

interface Harness {
	runtime: TicketsRuntime;
	localCalls: Array<{ teamId?: string }>;
}

function makeRuntime(opts: {
	cloudConnected: boolean;
	localConnected: boolean;
	cloudRows?: FakeTaskRow[];
	localTickets?: LocalLinearTicket[];
}): Harness {
	const localCalls: Array<{ teamId?: string }> = [];
	const api = fakeApi(opts.cloudRows ?? []);
	const runtime = new TicketsRuntime({
		isCloudConnected: () => opts.cloudConnected,
		isLocalConnected: () => opts.localConnected,
		listCloudTickets: () => fetchCloudTickets({ api }),
		listLocalTickets: (filter) => {
			localCalls.push(filter);
			const stored = opts.localTickets ?? [];
			const narrowed = filter.teamId
				? stored.filter((t) => t.team?.id === filter.teamId)
				: stored;
			return narrowed.map(mapLocalTicketToUnified);
		},
	});
	return { runtime, localCalls };
}

describe("TicketsRuntime", () => {
	it("resolves cloud tickets when cloud is connected (cloud wins)", async () => {
		const { runtime, localCalls } = makeRuntime({
			cloudConnected: true,
			localConnected: true,
			cloudRows: [cloudRow("t1", "ENG-1")],
			localTickets: [localTicket("i1", "ENG-99")],
		});

		const result = await runtime.list();
		expect(result.source).toBe("cloud");
		expect(result.tickets.map((t) => t.unifiedId)).toEqual(["cloud:t1"]);
		expect(result.tickets[0]?.identifier).toBe("ENG-1");
		// Local was never read while cloud is active.
		expect(localCalls).toEqual([]);
		expect(await runtime.activeSource()).toBe("cloud");
	});

	it("resolves local tickets when only local is connected", async () => {
		const { runtime } = makeRuntime({
			cloudConnected: false,
			localConnected: true,
			localTickets: [localTicket("i1", "ENG-99")],
		});

		const result = await runtime.list();
		expect(result.source).toBe("local");
		expect(result.tickets.map((t) => t.unifiedId)).toEqual(["local:i1"]);
		expect(result.tickets[0]?.source).toBe("local");
		expect(await runtime.activeSource()).toBe("local");
	});

	it("passes the team filter through to the local source", async () => {
		const { runtime, localCalls } = makeRuntime({
			cloudConnected: false,
			localConnected: true,
			localTickets: [
				localTicket("i1", "ENG-1"),
				{
					...localTicket("i2", "DES-1"),
					team: { id: "team-2", key: "DES", name: "Design" },
				},
			],
		});

		const result = await runtime.list({ teamId: "team-2" });
		expect(localCalls).toEqual([{ teamId: "team-2" }]);
		expect(result.tickets.map((t) => t.sourceId)).toEqual(["i2"]);
	});

	it("returns empty + source null when neither is connected", async () => {
		const { runtime } = makeRuntime({
			cloudConnected: false,
			localConnected: false,
			cloudRows: [cloudRow("t1", "ENG-1")],
			localTickets: [localTicket("i1", "ENG-99")],
		});

		const result = await runtime.list();
		expect(result.source).toBeNull();
		expect(result.tickets).toEqual([]);
		expect(await runtime.activeSource()).toBeNull();
	});
});
