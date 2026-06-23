import { describe, expect, it } from "bun:test";
import type { Playbook, ProjectIndexEntry } from "../types";
import {
	assembleRetrievalBundle,
	deriveQueryAreas,
	estimateTokens,
} from "./retrieval";

const now = 1_000 * 86_400_000;

function playbook(overrides: Partial<Playbook>): Playbook {
	return {
		id: "p",
		projectId: "proj",
		intent: "do a thing",
		touchedPaths: [],
		areaTags: ["backend"],
		commands: ["bun test"],
		gotcha: null,
		diffShape: null,
		validation: null,
		status: "confirmed",
		confidence: 80,
		provenance: { prNumber: null, url: null, taskId: null },
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function indexEntry(overrides: Partial<ProjectIndexEntry>): ProjectIndexEntry {
	return {
		id: "i",
		projectId: "proj",
		path: "packages/host-service/src/x.ts",
		kind: "file",
		areaTags: ["backend"],
		summary: "[backend] exports: x",
		fingerprintId: "fp",
		updatedAt: now,
		...overrides,
	};
}

describe("estimateTokens", () => {
	it("uses ~4 chars per token, min 1 for non-empty", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("a".repeat(40))).toBe(10);
	});
});

describe("deriveQueryAreas", () => {
	it("unions explicit areas with path-derived areas", () => {
		const areas = deriveQueryAreas({
			intent: "edit packages/db/src/schema/users.ts",
			explicitAreas: ["frontend"],
		});
		expect(areas).toContain("frontend");
		expect(areas).toContain("schema");
	});

	it("derives areas from keywords without explicit paths", () => {
		expect(deriveQueryAreas({ intent: "add a new trpc endpoint" })).toContain(
			"backend",
		);
		expect(
			deriveQueryAreas({ intent: "write a migration for the table" }),
		).toContain("schema");
	});

	it("falls back to ['other'] when nothing matches", () => {
		expect(deriveQueryAreas({ intent: "ponder existence" })).toEqual(["other"]);
	});
});

describe("assembleRetrievalBundle", () => {
	it("area-filters and ranks playbooks + index slices by the query areas", () => {
		const bundle = assembleRetrievalBundle({
			intent: "fix the backend api",
			playbooks: [
				playbook({ id: "backend1", areaTags: ["backend"] }),
				playbook({ id: "frontend1", areaTags: ["frontend"] }),
			],
			indexEntries: [
				indexEntry({ id: "b", path: "a/backend.ts", areaTags: ["backend"] }),
				indexEntry({ id: "f", path: "a/frontend.ts", areaTags: ["frontend"] }),
			],
			now,
		});
		expect(bundle.queryAreas).toContain("backend");
		expect(bundle.playbooks.map((p) => p.id)).toEqual(["backend1"]);
		expect(bundle.indexSlices.map((s) => s.path)).toEqual(["a/backend.ts"]);
	});

	it("respects topK caps", () => {
		const playbooks = Array.from({ length: 8 }, (_, i) =>
			playbook({ id: `p${i}`, areaTags: ["backend"] }),
		);
		const bundle = assembleRetrievalBundle({
			intent: "backend work",
			playbooks,
			indexEntries: [],
			topKPlaybooks: 3,
			now,
		});
		expect(bundle.playbooks).toHaveLength(3);
	});

	it("enforces the token cap by trimming lowest-ranked items first", () => {
		// Big index summaries so the bundle exceeds a tiny budget.
		const indexEntries = Array.from({ length: 10 }, (_, i) =>
			indexEntry({
				id: `i${i}`,
				path: `a/file${i}.ts`,
				areaTags: ["backend"],
				summary: "x".repeat(400),
				updatedAt: now - i * 86_400_000,
			}),
		);
		const bundle = assembleRetrievalBundle({
			intent: "backend",
			playbooks: [playbook({ id: "keep", areaTags: ["backend"] })],
			indexEntries,
			maxTokens: 200,
			now,
		});
		expect(bundle.trimmed).toBe(true);
		expect(bundle.estimatedTokens).toBeLessThanOrEqual(200);
		expect(bundle.estimatedTokensBeforeCap).toBeGreaterThan(200);
		// Index slices trimmed before the (higher-signal) playbook.
		expect(bundle.indexSlices.length).toBeLessThan(indexEntries.length);
	});

	it("keeps practices as the highest-signal layer until they alone exceed budget", () => {
		const bundle = assembleRetrievalBundle({
			intent: "backend",
			playbooks: [],
			indexEntries: [],
			practices: [
				{ scope: "project", content: "use object params", version: 1 },
			],
			maxTokens: 2000,
			now,
		});
		expect(bundle.practices).toHaveLength(1);
	});

	it("with an 'other' query keeps all candidates (no false area exclusion)", () => {
		const bundle = assembleRetrievalBundle({
			intent: "ponder existence",
			playbooks: [playbook({ id: "x", areaTags: ["frontend"] })],
			indexEntries: [],
			now,
		});
		expect(bundle.queryAreas).toEqual(["other"]);
		expect(bundle.playbooks).toHaveLength(1);
	});

	it("semanticSlices is [] when none supplied (embeddings off = unchanged bundle)", () => {
		const bundle = assembleRetrievalBundle({
			intent: "backend",
			playbooks: [],
			indexEntries: [],
			now,
		});
		expect(bundle.semanticSlices).toEqual([]);
	});

	it("blends supplied semantic slices into the bundle (B7 enabled path)", () => {
		const bundle = assembleRetrievalBundle({
			intent: "backend",
			playbooks: [],
			indexEntries: [],
			semanticSlices: [
				{ path: "a/sem.ts", summary: "[backend]", similarity: 0.8 },
			],
			now,
		});
		expect(bundle.semanticSlices.map((s) => s.path)).toEqual(["a/sem.ts"]);
	});

	it("trims semantic slices FIRST under the token cap", () => {
		const bundle = assembleRetrievalBundle({
			intent: "backend",
			playbooks: [playbook({ id: "keep", areaTags: ["backend"] })],
			indexEntries: [],
			semanticSlices: Array.from({ length: 6 }, (_, i) => ({
				path: `a/sem${i}.ts`,
				summary: "x".repeat(400),
				similarity: 0.5,
			})),
			maxTokens: 200,
			now,
		});
		expect(bundle.trimmed).toBe(true);
		expect(bundle.estimatedTokens).toBeLessThanOrEqual(200);
		// Semantic slices trimmed before the playbook survives.
		expect(bundle.semanticSlices.length).toBeLessThan(6);
		expect(bundle.playbooks.some((p) => p.id === "keep")).toBe(true);
	});
});
