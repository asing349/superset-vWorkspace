import { describe, expect, it } from "bun:test";
import { buildLocalTicketContextDraft } from "./buildLocalTicketContextDraft";

describe("buildLocalTicketContextDraft", () => {
	it("uses just the heading when there is no description", () => {
		expect(
			buildLocalTicketContextDraft({
				identifier: "ENG-123",
				title: "Fix the thing",
				description: null,
			}),
		).toBe("# ENG-123: Fix the thing");
	});

	it("appends a trimmed description after a blank line", () => {
		expect(
			buildLocalTicketContextDraft({
				identifier: "ENG-123",
				title: "Fix the thing",
				description: "  Details about the thing.  ",
			}),
		).toBe("# ENG-123: Fix the thing\n\nDetails about the thing.");
	});

	it("ignores a whitespace-only description", () => {
		expect(
			buildLocalTicketContextDraft({
				identifier: "ENG-9",
				title: "Tidy",
				description: "   \n  ",
			}),
		).toBe("# ENG-9: Tidy");
	});
});
