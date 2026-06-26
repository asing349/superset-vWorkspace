import { describe, expect, it } from "bun:test";
import type { LocalLinearTicket } from "../linear-tickets";
import {
	type CloudTaskListRow,
	mapCloudTaskToUnified,
	mapLocalTicketToUnified,
} from "./mappers";

function makeCloudRow(
	overrides: Partial<CloudTaskListRow["task"]> = {},
	extra: Partial<Omit<CloudTaskListRow, "task">> = {},
): CloudTaskListRow {
	return {
		task: {
			id: "task-uuid-1",
			slug: "super-1",
			title: "Cloud ticket",
			description: "Cloud details",
			priority: "high",
			externalProvider: "linear",
			externalKey: "ENG-9",
			externalUrl: "https://linear.app/acme/issue/ENG-9",
			createdAt: new Date("2026-06-01T00:00:00.000Z"),
			updatedAt: new Date("2026-06-20T00:00:00.000Z"),
			...overrides,
		},
		assignee: { name: "Grace" },
		statusName: "In Progress",
		...extra,
	};
}

function makeLocalTicket(
	overrides: Partial<LocalLinearTicket> = {},
): LocalLinearTicket {
	return {
		id: "issue-uuid-1",
		identifier: "ENG-123",
		title: "Local ticket",
		description: "Local details",
		url: "https://linear.app/acme/issue/ENG-123",
		priority: 2,
		priorityLabel: "high",
		state: { id: "state-1", name: "In Progress", type: "started" },
		assignee: { id: "user-1", name: "Ada", email: "ada@example.com" },
		team: { id: "team-1", key: "ENG", name: "Engineering" },
		createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
		updatedAt: Date.parse("2026-06-20T00:00:00.000Z"),
		syncedAt: 1_000,
		...overrides,
	};
}

describe("mapCloudTaskToUnified", () => {
	it("normalizes a cloud Linear-synced task into a unified ticket", () => {
		const ticket = mapCloudTaskToUnified(makeCloudRow());
		expect(ticket).toEqual({
			unifiedId: "cloud:task-uuid-1",
			source: "cloud",
			sourceId: "task-uuid-1",
			identifier: "ENG-9",
			title: "Cloud ticket",
			description: "Cloud details",
			url: "https://linear.app/acme/issue/ENG-9",
			priority: "high",
			state: { name: "In Progress" },
			assignee: { name: "Grace" },
			team: null,
			createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
			updatedAt: Date.parse("2026-06-20T00:00:00.000Z"),
		});
	});

	it("falls back to the slug when externalKey is absent", () => {
		const ticket = mapCloudTaskToUnified(makeCloudRow({ externalKey: null }));
		expect(ticket.identifier).toBe("super-1");
	});

	it("coerces an unknown priority to 'none' and handles null assignee/url", () => {
		const ticket = mapCloudTaskToUnified(
			makeCloudRow(
				{ priority: "bogus", externalUrl: null },
				{ assignee: null, statusName: null },
			),
		);
		expect(ticket.priority).toBe("none");
		expect(ticket.url).toBeNull();
		expect(ticket.assignee).toBeNull();
		expect(ticket.state).toEqual({ name: null });
	});
});

describe("mapLocalTicketToUnified", () => {
	it("normalizes a host-local Linear ticket into a unified ticket", () => {
		const ticket = mapLocalTicketToUnified(makeLocalTicket());
		expect(ticket).toEqual({
			unifiedId: "local:issue-uuid-1",
			source: "local",
			sourceId: "issue-uuid-1",
			identifier: "ENG-123",
			title: "Local ticket",
			description: "Local details",
			url: "https://linear.app/acme/issue/ENG-123",
			priority: "high",
			state: { name: "In Progress" },
			assignee: { name: "Ada" },
			team: { key: "ENG", name: "Engineering" },
			createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
			updatedAt: Date.parse("2026-06-20T00:00:00.000Z"),
		});
	});

	it("handles missing assignee/team/state", () => {
		const ticket = mapLocalTicketToUnified(
			makeLocalTicket({
				assignee: null,
				team: null,
				state: { id: null, name: null, type: null },
			}),
		);
		expect(ticket.assignee).toBeNull();
		expect(ticket.team).toBeNull();
		expect(ticket.state).toEqual({ name: null });
	});
});
