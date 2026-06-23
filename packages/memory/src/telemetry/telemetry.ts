import type { MemoryTelemetrySample } from "../types";

/**
 * Telemetry aggregation (PURE LOGIC, B4). Turns recorded
 * `MemoryTelemetrySample` rows into the "memory saved ~X%" stat the panel reads.
 * No I/O — the host loads samples and passes them in.
 *
 * "Saved %" for a metric = mean over samples that have BOTH a baseline and an
 * observed value of `(baseline - observed) / baseline`, clamped to [0, 1] then
 * expressed as a percentage. A positive value means memory reduced the metric
 * (fewer tokens / fewer exploration steps).
 */

export interface SavedStat {
	metric: string;
	/** Number of paired (baseline+observed) samples that contributed. */
	sampleCount: number;
	/** Mean saved fraction in [0,1]; 0 when no paired samples. */
	savedFraction: number;
	/** `savedFraction * 100`, rounded to 1 decimal. */
	savedPercent: number;
	/** Summed baseline across paired samples. */
	totalBaseline: number;
	/** Summed observed across paired samples. */
	totalObserved: number;
}

/** Compute the saved stat for a single metric from its samples. */
export function computeSavedStat(options: {
	metric: string;
	samples: readonly MemoryTelemetrySample[];
}): SavedStat {
	const { metric, samples } = options;
	const paired = samples.filter(
		(s) =>
			s.metric === metric && s.baselineValue !== null && s.baselineValue > 0,
	);

	let fractionSum = 0;
	let totalBaseline = 0;
	let totalObserved = 0;
	for (const sample of paired) {
		const baseline = sample.baselineValue as number;
		const observed = sample.observedValue;
		const saved = (baseline - observed) / baseline;
		fractionSum += clamp01(saved);
		totalBaseline += baseline;
		totalObserved += observed;
	}

	const savedFraction = paired.length === 0 ? 0 : fractionSum / paired.length;
	return {
		metric,
		sampleCount: paired.length,
		savedFraction,
		savedPercent: Math.round(savedFraction * 1000) / 10,
		totalBaseline,
		totalObserved,
	};
}

/** Compute saved stats for every metric present in the samples. */
export function computeSavedStats(
	samples: readonly MemoryTelemetrySample[],
): SavedStat[] {
	const metrics = [...new Set(samples.map((s) => s.metric))];
	return metrics.map((metric) => computeSavedStat({ metric, samples }));
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}
