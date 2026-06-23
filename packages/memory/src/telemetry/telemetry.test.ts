import { describe, expect, it } from "bun:test";
import type { MemoryTelemetrySample } from "../types";
import { computeSavedStat, computeSavedStats } from "./telemetry";

function sample(
	overrides: Partial<MemoryTelemetrySample>,
): MemoryTelemetrySample {
	return {
		id: "s",
		projectId: "proj",
		taskId: null,
		metric: "tokens",
		baselineValue: 1000,
		observedValue: 600,
		createdAt: 0,
		...overrides,
	};
}

describe("computeSavedStat", () => {
	it("computes the mean saved fraction over paired samples", () => {
		const stat = computeSavedStat({
			metric: "tokens",
			samples: [
				sample({ baselineValue: 1000, observedValue: 600 }), // 40%
				sample({ baselineValue: 1000, observedValue: 800 }), // 20%
			],
		});
		expect(stat.sampleCount).toBe(2);
		expect(stat.savedFraction).toBeCloseTo(0.3, 5);
		expect(stat.savedPercent).toBe(30);
		expect(stat.totalBaseline).toBe(2000);
		expect(stat.totalObserved).toBe(1400);
	});

	it("ignores samples without a baseline", () => {
		const stat = computeSavedStat({
			metric: "tokens",
			samples: [
				sample({ baselineValue: null, observedValue: 600 }),
				sample({ baselineValue: 1000, observedValue: 500 }), // 50%
			],
		});
		expect(stat.sampleCount).toBe(1);
		expect(stat.savedPercent).toBe(50);
	});

	it("clamps negative savings (memory cost more) to 0", () => {
		const stat = computeSavedStat({
			metric: "tokens",
			samples: [sample({ baselineValue: 1000, observedValue: 1500 })],
		});
		expect(stat.savedFraction).toBe(0);
		expect(stat.savedPercent).toBe(0);
	});

	it("returns zeros when there are no paired samples", () => {
		const stat = computeSavedStat({ metric: "tokens", samples: [] });
		expect(stat.sampleCount).toBe(0);
		expect(stat.savedFraction).toBe(0);
		expect(stat.savedPercent).toBe(0);
	});

	it("only counts samples for the requested metric", () => {
		const stat = computeSavedStat({
			metric: "tokens",
			samples: [
				sample({ metric: "tokens", baselineValue: 1000, observedValue: 500 }),
				sample({
					metric: "exploration_steps",
					baselineValue: 10,
					observedValue: 2,
				}),
			],
		});
		expect(stat.sampleCount).toBe(1);
	});
});

describe("computeSavedStats", () => {
	it("computes one stat per distinct metric", () => {
		const stats = computeSavedStats([
			sample({ metric: "tokens", baselineValue: 1000, observedValue: 500 }),
			sample({
				metric: "exploration_steps",
				baselineValue: 10,
				observedValue: 4,
			}),
		]);
		const byMetric = Object.fromEntries(stats.map((s) => [s.metric, s]));
		expect(byMetric.tokens?.savedPercent).toBe(50);
		expect(byMetric.exploration_steps?.savedPercent).toBe(60);
	});
});
