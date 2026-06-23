import { describe, expect, it } from "bun:test";
import {
	canReindex,
	detectionHint,
	detectionStatusCopy,
	type EmbeddingsStatus,
	embeddedCountCopy,
	type ReindexResult,
	reindexSummary,
} from "./embeddingsView";

function status(overrides: Partial<EmbeddingsStatus> = {}): EmbeddingsStatus {
	return {
		available: false,
		enabled: false,
		endpoint: "http://127.0.0.1:11434",
		embeddedCount: 0,
		...overrides,
	};
}

describe("detectionStatusCopy", () => {
	it("reports a detected model with endpoint + model", () => {
		expect(
			detectionStatusCopy(
				status({ available: true, model: "nomic-embed-text" }),
			),
		).toBe(
			"Local embedding model detected at http://127.0.0.1:11434 · nomic-embed-text",
		);
	});

	it("omits the model when unknown", () => {
		expect(detectionStatusCopy(status({ available: true }))).toBe(
			"Local embedding model detected at http://127.0.0.1:11434",
		);
	});

	it("reports no model when unavailable", () => {
		expect(detectionStatusCopy(status({ available: false }))).toBe(
			"No local embedding model detected",
		);
	});
});

describe("detectionHint", () => {
	it("emphasizes local-only when available, guidance when not", () => {
		expect(detectionHint(status({ available: true }))).toContain(
			"stay on your machine",
		);
		expect(detectionHint(status({ available: false }))).toContain("Optional");
	});
});

describe("canReindex", () => {
	it("requires both enabled AND available", () => {
		expect(canReindex(status({ enabled: true, available: true }))).toBe(true);
		expect(canReindex(status({ enabled: true, available: false }))).toBe(false);
		expect(canReindex(status({ enabled: false, available: true }))).toBe(false);
		expect(canReindex(status({ enabled: false, available: false }))).toBe(
			false,
		);
	});
});

describe("reindexSummary", () => {
	function result(overrides: Partial<ReindexResult> = {}): ReindexResult {
		return { embedded: 0, evicted: 0, skipped: false, ...overrides };
	}

	it("notes a no-op when skipped", () => {
		expect(reindexSummary(result({ skipped: true }))).toContain(
			"Nothing to do",
		);
	});

	it("summarizes embedded + evicted counts", () => {
		expect(reindexSummary(result({ embedded: 5 }))).toBe(
			"Reindexed: 5 embedded.",
		);
		expect(reindexSummary(result({ embedded: 5, evicted: 2 }))).toBe(
			"Reindexed: 5 embedded, 2 evicted.",
		);
	});
});

describe("embeddedCountCopy", () => {
	it("is null when disabled", () => {
		expect(
			embeddedCountCopy(status({ enabled: false, embeddedCount: 9 })),
		).toBeNull();
	});

	it("pluralizes the count when enabled", () => {
		expect(embeddedCountCopy(status({ enabled: true, embeddedCount: 1 }))).toBe(
			"1 file embedded",
		);
		expect(embeddedCountCopy(status({ enabled: true, embeddedCount: 3 }))).toBe(
			"3 files embedded",
		);
	});
});
