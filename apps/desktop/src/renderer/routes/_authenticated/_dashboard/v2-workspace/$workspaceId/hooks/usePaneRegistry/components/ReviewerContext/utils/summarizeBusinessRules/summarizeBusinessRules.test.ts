import { describe, expect, it } from "bun:test";
import {
	type BusinessRuleLike,
	summarizeBusinessRules,
} from "./summarizeBusinessRules";

const rule = (state: BusinessRuleLike["state"]): BusinessRuleLike => ({
	state,
});

describe("summarizeBusinessRules", () => {
	it("reads 'No rules yet' for an empty layer", () => {
		const s = summarizeBusinessRules([]);
		expect(s).toEqual({
			accepted: 0,
			proposed: 0,
			reverted: 0,
			hasPending: false,
			badgeLabel: "No rules yet",
		});
	});

	it("counts by state and flags pending proposals", () => {
		const s = summarizeBusinessRules([
			rule("accepted"),
			rule("accepted"),
			rule("proposed"),
			rule("reverted"),
		]);
		expect(s.accepted).toBe(2);
		expect(s.proposed).toBe(1);
		expect(s.reverted).toBe(1);
		expect(s.hasPending).toBe(true);
		expect(s.badgeLabel).toBe("2 active · 1 pending");
	});

	it("shows only the active count when nothing is pending", () => {
		const s = summarizeBusinessRules([rule("accepted")]);
		expect(s.hasPending).toBe(false);
		expect(s.badgeLabel).toBe("1 active");
	});

	it("shows only the pending count when nothing is accepted yet", () => {
		const s = summarizeBusinessRules([rule("proposed"), rule("proposed")]);
		expect(s.badgeLabel).toBe("2 pending");
		expect(s.hasPending).toBe(true);
	});
});
