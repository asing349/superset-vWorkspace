import { describe, expect, it } from "bun:test";
import {
	confidenceLabel,
	formatPercent,
	formatSavedHeadline,
	isAntiPattern,
	provenanceLabel,
	type SavedStat,
	statusLabel,
	statusTone,
} from "./memoryFormat";

function stat(overrides: Partial<SavedStat> = {}): SavedStat {
	return {
		metric: "tokens",
		sampleCount: 3,
		savedFraction: 0.3,
		savedPercent: 30,
		totalBaseline: 1000,
		totalObserved: 700,
		...overrides,
	};
}

describe("formatSavedHeadline", () => {
	it("returns a friendly message when there are no samples", () => {
		expect(formatSavedHeadline([])).toBe("No data yet");
		expect(formatSavedHeadline([stat({ sampleCount: 0 })])).toBe("No data yet");
	});

	it("formats the tokens metric as a saved percentage", () => {
		expect(formatSavedHeadline([stat({ savedPercent: 30 })])).toBe(
			"Memory saved ~30%",
		);
	});

	it("prefers the tokens metric over other metrics", () => {
		const stats = [
			stat({ metric: "exploration_steps", savedPercent: 10 }),
			stat({ metric: "tokens", savedPercent: 42.5 }),
		];
		expect(formatSavedHeadline(stats)).toBe("Memory saved ~42.5%");
	});

	it("falls back to the first usable metric when tokens is absent", () => {
		expect(
			formatSavedHeadline([
				stat({ metric: "exploration_steps", savedPercent: 15 }),
			]),
		).toBe("Memory saved ~15%");
	});

	it("honestly reports a negative saving as a cost", () => {
		expect(formatSavedHeadline([stat({ savedPercent: -12 })])).toBe(
			"Memory cost ~12%",
		);
	});
});

describe("formatPercent", () => {
	it("trims a trailing .0 and keeps one decimal otherwise", () => {
		expect(formatPercent(30)).toBe("30%");
		expect(formatPercent(42.5)).toBe("42.5%");
		expect(formatPercent(42.04)).toBe("42%");
	});

	it("guards against non-finite input", () => {
		expect(formatPercent(Number.NaN)).toBe("0%");
		expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("0%");
	});
});

describe("statusLabel + statusTone", () => {
	it("labels each status", () => {
		expect(statusLabel("provisional")).toBe("Provisional");
		expect(statusLabel("confirmed")).toBe("Confirmed");
		expect(statusLabel("demoted")).toBe("Demoted");
		expect(statusLabel("archived")).toBe("Archived");
	});

	it("maps status to a visual tone", () => {
		expect(statusTone("confirmed")).toBe("positive");
		expect(statusTone("demoted")).toBe("warning");
		expect(statusTone("archived")).toBe("muted");
		expect(statusTone("provisional")).toBe("neutral");
	});
});

describe("isAntiPattern", () => {
	it("detects the B2 anti-pattern gotcha prefix", () => {
		expect(isAntiPattern({ gotcha: "[anti-pattern] PR closed" })).toBe(true);
		expect(isAntiPattern({ gotcha: "watch the lock" })).toBe(false);
		expect(isAntiPattern({ gotcha: null })).toBe(false);
	});
});

describe("provenanceLabel", () => {
	it("prefers the PR number", () => {
		expect(provenanceLabel({ prNumber: 123, url: "u", taskId: null })).toBe(
			"#123",
		);
	});

	it("falls back to a link label, then null", () => {
		expect(
			provenanceLabel({ prNumber: null, url: "https://x", taskId: null }),
		).toBe("link");
		expect(
			provenanceLabel({ prNumber: null, url: null, taskId: null }),
		).toBeNull();
	});
});

describe("confidenceLabel", () => {
	it("clamps to [0,100] and labels", () => {
		expect(confidenceLabel(80)).toBe("80% confidence");
		expect(confidenceLabel(-5)).toBe("0% confidence");
		expect(confidenceLabel(140)).toBe("100% confidence");
	});
});
