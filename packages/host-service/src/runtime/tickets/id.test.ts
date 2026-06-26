import { describe, expect, it } from "bun:test";
import {
	makeUnifiedTicketId,
	parseUnifiedTicketId,
	resolveWritebackTarget,
} from "./id";

describe("unified ticket id helpers", () => {
	it("round-trips a cloud id (UUID source id)", () => {
		const sourceId = "22222222-2222-4222-8222-222222222222";
		const unifiedId = makeUnifiedTicketId({ source: "cloud", sourceId });
		expect(unifiedId).toBe(`cloud:${sourceId}`);
		expect(parseUnifiedTicketId(unifiedId)).toEqual({
			source: "cloud",
			sourceId,
		});
	});

	it("round-trips a local id (Linear issue id)", () => {
		const sourceId = "issue-uuid-1";
		const unifiedId = makeUnifiedTicketId({ source: "local", sourceId });
		expect(unifiedId).toBe("local:issue-uuid-1");
		expect(parseUnifiedTicketId(unifiedId)).toEqual({
			source: "local",
			sourceId,
		});
	});

	it("keeps a source id that itself contains a colon intact", () => {
		// Only the FIRST colon separates source from id, so an id with colons
		// (defensive — Linear ids don't, but be robust) survives the round-trip.
		const sourceId = "weird:id:with:colons";
		const unifiedId = makeUnifiedTicketId({ source: "local", sourceId });
		expect(parseUnifiedTicketId(unifiedId)).toEqual({
			source: "local",
			sourceId,
		});
	});

	it("rejects malformed ids", () => {
		expect(() => parseUnifiedTicketId("no-separator")).toThrow();
		expect(() => parseUnifiedTicketId(":missing-source")).toThrow();
		expect(() => parseUnifiedTicketId("cloud:")).toThrow();
		expect(() => parseUnifiedTicketId("jira:abc")).toThrow();
	});

	it("routes writeback to the active source", () => {
		expect(
			resolveWritebackTarget({ source: "cloud", sourceId: "task-1" }),
		).toEqual({ kind: "cloud", taskId: "task-1" });
		expect(
			resolveWritebackTarget({ source: "local", sourceId: "issue-1" }),
		).toEqual({ kind: "local", issueId: "issue-1" });
	});
});
