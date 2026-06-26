import { describe, expect, it } from "bun:test";
import type { RetrievalBundle } from "@superset/memory";
import type { GuideGroundingServices } from "./build-guide-skeleton.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import type { FindingsReport } from "./findings-types.ts";
import {
	type FindingsCacheSink,
	type ReviewDiffSource,
	reviewPrCore,
} from "./review-pr.ts";

/**
 * Wave-6 M1 review-pr pipeline test (injected ports, no GitHub/chat/db). Covers:
 *  - baseline-only when no session (a migration risk flag → a baseline finding),
 *  - local-AI enrichment merged on top + anti-hallucination drop of off-diff
 *    files end-to-end,
 *  - persistence keyed by head SHA, and no-persist on an empty diff.
 */

const EMPTY_BUNDLE: RetrievalBundle = {
	queryAreas: [],
	practices: [],
	playbooks: [],
	indexSlices: [],
	semanticSlices: [],
	estimatedTokens: 0,
	estimatedTokensBeforeCap: 0,
	trimmed: false,
};

function ungroundedServices(): GuideGroundingServices {
	return {
		retrieve: { retrieve: () => EMPTY_BUNDLE },
		index: {
			indexStatus: () => ({ indexed: false, entryCount: 0 }),
			listEntries: () => [],
		},
		practice: { getPractice: () => ({ latest: null }) },
		playbooks: { listPlaybooks: () => [] },
	};
}

/** A diff with a migration file (→ a deterministic baseline risk flag). */
function diffSourceWith(headSha: string): ReviewDiffSource {
	return {
		fetch: async ({ prNumber }) => ({
			prNumber,
			headSha,
			baseBranch: "main",
			body: "Adds a migration",
			files: [
				{
					filename: "drizzle/0001_init.sql",
					status: "added",
					patch: "@@ -0,0 +1,2 @@\n+CREATE TABLE x;\n+CREATE TABLE y;",
					additions: 2,
					deletions: 0,
				},
				{
					filename: "src/app.ts",
					status: "modified",
					patch: "@@ -1,2 +1,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;",
					additions: 1,
					deletions: 0,
				},
			],
		}),
	};
}

describe("reviewPrCore", () => {
	it("returns the deterministic baseline (baselineOnly) when no session is supplied", async () => {
		const report = await reviewPrCore({
			projectId: "proj-1",
			prNumber: 7,
			diffSource: diffSourceWith("sha-7"),
			grounding: ungroundedServices(),
			session: null,
		});
		expect(report.prNumber).toBe(7);
		expect(report.headSha).toBe("sha-7");
		expect(report.baselineOnly).toBe(true);
		expect(report.enriched).toBe(false);
		// The migration file is flagged by the deterministic risk heuristic.
		const migration = report.findings.find(
			(f) => f.anchor.file === "drizzle/0001_init.sql",
		);
		expect(migration).toBeDefined();
		expect(migration?.source).toBe("baseline");
		expect(migration?.category).toBe("correctness");
	});

	it("merges validated/redacted/anchored local-AI findings on top of the baseline and persists", async () => {
		let persisted: {
			projectId: string;
			prNumber: number;
			headSha: string;
			report: FindingsReport;
		} | null = null;
		const cache: FindingsCacheSink = {
			put: (args) => {
				persisted = args;
			},
		};
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () =>
				JSON.stringify({
					findings: [
						{
							severity: "warning",
							category: "correctness",
							file: "src/app.ts",
							line: 2, // within the +1,3 hunk
							rationale: "const b is unused.",
						},
						{
							// anti-hallucination: not in the diff → dropped end-to-end.
							severity: "danger",
							category: "security",
							file: "src/secret-not-in-diff.ts",
							rationale: "hallucinated",
						},
					],
				}),
		};

		const report = await reviewPrCore({
			projectId: "proj-1",
			prNumber: 9,
			diffSource: diffSourceWith("sha-9"),
			grounding: ungroundedServices(),
			session,
			cache,
		});

		expect(report.enriched).toBe(true);
		expect(report.baselineOnly).toBe(false);

		const aiFindings = report.findings.filter((f) => f.source === "local-ai");
		expect(aiFindings.length).toBe(1);
		expect(aiFindings[0]?.anchor.file).toBe("src/app.ts");
		expect(aiFindings[0]?.anchor.line).toBe(2);
		// The off-diff hallucinated file never made it through.
		expect(
			report.findings.some(
				(f) => f.anchor.file === "src/secret-not-in-diff.ts",
			),
		).toBe(false);

		expect(persisted).not.toBeNull();
		const saved = persisted as unknown as {
			headSha: string;
			report: FindingsReport;
		};
		expect(saved.headSha).toBe("sha-9");
		expect(saved.report.findings.length).toBe(report.findings.length);
	});

	it("degrades to the baseline when the session yields nothing (no throw)", async () => {
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => null,
		};
		const report = await reviewPrCore({
			projectId: "proj-1",
			prNumber: 11,
			diffSource: diffSourceWith("sha-11"),
			grounding: ungroundedServices(),
			session,
		});
		expect(report.enriched).toBe(false);
		// A session existed (just produced nothing), so it isn't "baselineOnly".
		expect(report.baselineOnly).toBe(false);
		expect(report.findings.every((f) => f.source === "baseline")).toBe(true);
	});

	it("does NOT persist when the diff couldn't resolve (empty head SHA)", async () => {
		let putCalls = 0;
		const cache: FindingsCacheSink = {
			put: () => {
				putCalls += 1;
			},
		};
		const emptyDiffSource: ReviewDiffSource = {
			fetch: async ({ prNumber }) => ({
				prNumber,
				headSha: "",
				baseBranch: "",
				body: null,
				files: [],
			}),
		};
		await reviewPrCore({
			projectId: "proj-1",
			prNumber: 13,
			diffSource: emptyDiffSource,
			grounding: ungroundedServices(),
			session: null,
			cache,
		});
		expect(putCalls).toBe(0);
	});
});
