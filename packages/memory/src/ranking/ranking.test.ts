import { describe, expect, it } from "bun:test";
import type { AreaTag } from "../types";
import { rankByAreaAndRecency } from "./ranking";

function item(areaTags: AreaTag[], updatedAt: number) {
	return { areaTags, updatedAt };
}

describe("rankByAreaAndRecency", () => {
	const now = 1_000 * 86_400_000; // a fixed "now" in epoch ms

	it("ranks higher area overlap first", () => {
		const items = [item(["frontend"], now), item(["backend", "schema"], now)];
		const ranked = rankByAreaAndRecency(items, {
			queryAreas: ["backend", "schema"],
			now,
		});
		expect(ranked[0]?.item.areaTags).toEqual(["backend", "schema"]);
	});

	it("uses recency to break ties when area overlap is equal", () => {
		const recent = item(["backend"], now);
		const old = item(["backend"], now - 60 * 86_400_000);
		const ranked = rankByAreaAndRecency([old, recent], {
			queryAreas: ["backend"],
			now,
		});
		expect(ranked[0]?.item).toBe(recent);
	});

	it("respects topK", () => {
		const items = [
			item(["backend"], now),
			item(["frontend"], now),
			item(["schema"], now),
		];
		const ranked = rankByAreaAndRecency(items, {
			queryAreas: ["backend"],
			now,
			topK: 1,
		});
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.item.areaTags).toEqual(["backend"]);
	});

	it("returns all items (scored) when topK is omitted", () => {
		const items = [item(["backend"], now), item(["frontend"], now)];
		const ranked = rankByAreaAndRecency(items, {
			queryAreas: ["backend"],
			now,
		});
		expect(ranked).toHaveLength(2);
		expect(ranked.every((r) => typeof r.score === "number")).toBe(true);
	});

	it("handles empty candidate and query sets", () => {
		expect(rankByAreaAndRecency([], { queryAreas: ["backend"] })).toEqual([]);
		const ranked = rankByAreaAndRecency([item(["backend"], now)], {
			queryAreas: [],
			now,
		});
		expect(ranked).toHaveLength(1);
	});
});
