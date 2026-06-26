import { describe, expect, it } from "bun:test";
import { resolveActiveSource, resolveActiveTickets } from "./resolver";
import type { UnifiedTicket } from "./types";

function cloudTicket(id: string): UnifiedTicket {
	return {
		unifiedId: `cloud:${id}`,
		source: "cloud",
		sourceId: id,
		identifier: id,
		title: `cloud ${id}`,
		description: null,
		url: null,
		priority: "none",
		state: { name: null },
		assignee: null,
		team: null,
		createdAt: null,
		updatedAt: null,
	};
}

function localTicket(id: string): UnifiedTicket {
	return { ...cloudTicket(id), unifiedId: `local:${id}`, source: "local" };
}

describe("resolveActiveSource", () => {
	it("applies cloud-precedence: cloud > local > none", () => {
		expect(
			resolveActiveSource({ cloudConnected: true, localConnected: true }),
		).toBe("cloud");
		expect(
			resolveActiveSource({ cloudConnected: true, localConnected: false }),
		).toBe("cloud");
		expect(
			resolveActiveSource({ cloudConnected: false, localConnected: true }),
		).toBe("local");
		expect(
			resolveActiveSource({ cloudConnected: false, localConnected: false }),
		).toBeNull();
	});
});

describe("resolveActiveTickets", () => {
	it("returns cloud tickets when cloud is connected", async () => {
		const result = await resolveActiveTickets({
			isCloudConnected: () => true,
			isLocalConnected: () => true,
			listCloudTickets: () => [cloudTicket("c1")],
			listLocalTickets: () => [localTicket("l1")],
		});
		expect(result.source).toBe("cloud");
		expect(result.tickets.map((t) => t.unifiedId)).toEqual(["cloud:c1"]);
	});

	it("never probes local while cloud is active (cloud-precedence)", async () => {
		let localProbed = false;
		const result = await resolveActiveTickets({
			isCloudConnected: () => true,
			isLocalConnected: () => {
				localProbed = true;
				return true;
			},
			listCloudTickets: () => [cloudTicket("c1")],
			listLocalTickets: () => [localTicket("l1")],
		});
		expect(result.source).toBe("cloud");
		expect(localProbed).toBe(false);
	});

	it("returns local tickets when only local is connected", async () => {
		const result = await resolveActiveTickets({
			isCloudConnected: () => false,
			isLocalConnected: () => true,
			listCloudTickets: () => [cloudTicket("c1")],
			listLocalTickets: () => [localTicket("l1")],
		});
		expect(result.source).toBe("local");
		expect(result.tickets.map((t) => t.unifiedId)).toEqual(["local:l1"]);
	});

	it("forwards the read-time filter to the local source", async () => {
		const seen: Array<{ teamId?: string }> = [];
		await resolveActiveTickets({
			isCloudConnected: () => false,
			isLocalConnected: () => true,
			listCloudTickets: () => [],
			listLocalTickets: (filter) => {
				seen.push(filter);
				return [];
			},
			filter: { teamId: "team-1" },
		});
		expect(seen).toEqual([{ teamId: "team-1" }]);
	});

	it("returns empty + source null when neither is connected", async () => {
		const result = await resolveActiveTickets({
			isCloudConnected: () => false,
			isLocalConnected: () => false,
			listCloudTickets: () => [cloudTicket("c1")],
			listLocalTickets: () => [localTicket("l1")],
		});
		expect(result.source).toBeNull();
		expect(result.tickets).toEqual([]);
	});

	it("supports async connection checks + adapters", async () => {
		const result = await resolveActiveTickets({
			isCloudConnected: async () => false,
			isLocalConnected: async () => true,
			listCloudTickets: async () => [],
			listLocalTickets: async () => [localTicket("l9")],
		});
		expect(result.source).toBe("local");
		expect(result.tickets.map((t) => t.sourceId)).toEqual(["l9"]);
	});
});
