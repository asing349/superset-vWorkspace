import { describe, expect, it } from "bun:test";
import type { ApiClient } from "../../types";
import { fetchCloudTickets } from "./cloud-source";

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

/**
 * Build a fake cloud API client whose `task.list.query` returns `rows`. Only the
 * single method `fetchCloudTickets` touches is implemented; the cast keeps the
 * fake off the network (no real TRPCClient is constructed).
 */
function fakeApi(rows: FakeTaskRow[]): {
	api: ApiClient;
	calls: Array<{ limit?: number }>;
} {
	const calls: Array<{ limit?: number }> = [];
	const api = {
		task: {
			list: {
				query: async (input?: { limit?: number }) => {
					calls.push(input ?? {});
					return rows;
				},
			},
		},
	} as unknown as ApiClient;
	return { api, calls };
}

function makeRow(overrides: Partial<FakeTaskRow["task"]> = {}): FakeTaskRow {
	return {
		task: {
			id: "task-1",
			slug: "super-1",
			title: "A task",
			description: null,
			priority: "none",
			externalProvider: "linear",
			externalKey: "ENG-1",
			externalUrl: "https://linear.app/acme/issue/ENG-1",
			createdAt: new Date("2026-06-01T00:00:00.000Z"),
			updatedAt: new Date("2026-06-02T00:00:00.000Z"),
			...overrides,
		},
		assignee: null,
		statusName: null,
	};
}

describe("fetchCloudTickets", () => {
	it("returns only Linear-synced tasks, normalized + source-tagged", async () => {
		const { api, calls } = fakeApi([
			makeRow({ id: "linear-1", externalProvider: "linear" }),
			makeRow({ id: "github-1", externalProvider: "github" }),
			makeRow({ id: "local-only", externalProvider: null }),
		]);

		const tickets = await fetchCloudTickets({ api });

		expect(tickets.map((t) => t.sourceId)).toEqual(["linear-1"]);
		expect(tickets[0]?.source).toBe("cloud");
		expect(tickets[0]?.unifiedId).toBe("cloud:linear-1");
		// Reads a single capped page (max 500 per the cloud task.list schema).
		expect(calls).toEqual([{ limit: 500 }]);
	});

	it("returns an empty list when there are no Linear-synced tasks", async () => {
		const { api } = fakeApi([makeRow({ externalProvider: "github" })]);
		expect(await fetchCloudTickets({ api })).toEqual([]);
	});
});
