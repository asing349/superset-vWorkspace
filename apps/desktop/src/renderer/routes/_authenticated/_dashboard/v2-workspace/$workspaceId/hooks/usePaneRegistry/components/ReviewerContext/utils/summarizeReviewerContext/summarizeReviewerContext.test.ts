import { describe, expect, it } from "bun:test";
import {
	type ReviewerContextSummaryInput,
	summarizeReviewerContext,
} from "./summarizeReviewerContext.ts";

const ready: ReviewerContextSummaryInput = {
	configured: true,
	stale: false,
	diff: { changed: false, changes: [] },
};

describe("summarizeReviewerContext (M5)", () => {
	it("reports not-configured for null status", () => {
		const s = summarizeReviewerContext(null);
		expect(s.state).toBe("not-configured");
		expect(s.canRefresh).toBe(false);
		expect(s.badgeLabel).toBe("Not set up");
	});

	it("reports not-configured when configured is false", () => {
		const s = summarizeReviewerContext({ ...ready, configured: false });
		expect(s.state).toBe("not-configured");
	});

	it("reports ready when configured and not stale/changed", () => {
		const s = summarizeReviewerContext(ready);
		expect(s.state).toBe("ready");
		expect(s.canRefresh).toBe(true);
		expect(s.changeDetails).toHaveLength(0);
	});

	it("reports changed (with diff details) when the diff changed", () => {
		const s = summarizeReviewerContext({
			...ready,
			diff: {
				changed: true,
				changes: [
					{ kind: "practice-project", detail: "Project practice v1 → v2" },
				],
			},
		});
		expect(s.state).toBe("changed");
		expect(s.canRefresh).toBe(true);
		expect(s.changeDetails).toEqual(["Project practice v1 → v2"]);
	});

	it("reports changed via the flag-only stale signal, with a generic detail", () => {
		const s = summarizeReviewerContext({
			...ready,
			stale: true,
			diff: { changed: false, changes: [] },
		});
		expect(s.state).toBe("changed");
		expect(s.changeDetails).toHaveLength(1);
		expect(s.changeDetails[0]).toMatch(/changed since setup/i);
	});
});
