import { describe, expect, it } from "bun:test";
import type { RetrievalBundle } from "@superset/memory";
import type { GuideGroundingServices } from "./build-guide-skeleton.ts";
import type { ObservedRuleDraft } from "./business-rules-types.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import type { FindingsReport } from "./findings-types.ts";
import {
	type FindingsCacheSink,
	type ObservedRulesSink,
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

describe("reviewPrCore — observed business rules (M6)", () => {
	/** Grounding whose accepted business rules are the supplied texts. */
	function groundingWithRules(accepted: string[]): GuideGroundingServices {
		return {
			...ungroundedServices(),
			businessRules: { listAccepted: () => accepted.map((rule) => ({ rule })) },
		};
	}

	it("grounds the findings prompt on accepted rules AND proposes inferred rules", async () => {
		let findingsPrompt: string | null = null;
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async ({ prompt }) => {
				// Two passes share `complete`: the findings pass, then the rules pass.
				if (prompt.includes("DOMAIN BUSINESS")) {
					return JSON.stringify({
						rules: [{ rule: "New: refunds within 14 days", confidence: 70 }],
					});
				}
				findingsPrompt = prompt;
				return JSON.stringify({ findings: [] });
			},
		};

		const proposed: ObservedRuleDraft[] = [];
		const sink: ObservedRulesSink = {
			propose: ({ drafts }) => proposed.push(...drafts),
		};

		await reviewPrCore({
			projectId: "proj-rules",
			prNumber: 21,
			diffSource: diffSourceWith("sha-21"),
			grounding: groundingWithRules(["Order total must never be negative"]),
			session,
			rules: { sink, gotchas: ["totals can underflow"] },
		});

		// The accepted rule grounded the findings prompt (the compounding loop).
		expect(findingsPrompt).not.toBeNull();
		expect(findingsPrompt as unknown as string).toContain(
			"Order total must never be negative",
		);
		// The inferred rule was proposed (redacted, never auto-accepted).
		expect(proposed).toHaveLength(1);
		expect(proposed[0]?.rule).toBe("New: refunds within 14 days");
	});

	it("does NOT propose when no session is connected (baseline only)", async () => {
		let proposeCalls = 0;
		const sink: ObservedRulesSink = {
			propose: () => {
				proposeCalls += 1;
			},
		};
		await reviewPrCore({
			projectId: "proj-rules",
			prNumber: 22,
			diffSource: diffSourceWith("sha-22"),
			grounding: groundingWithRules([]),
			session: null,
			rules: { sink, gotchas: [] },
		});
		expect(proposeCalls).toBe(0);
	});

	it("does NOT propose a rule the project has already accepted (dedupe)", async () => {
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async ({ prompt }) =>
				prompt.includes("DOMAIN BUSINESS")
					? JSON.stringify({
							rules: [{ rule: "Order total must never be negative" }],
						})
					: JSON.stringify({ findings: [] }),
		};
		const proposed: ObservedRuleDraft[] = [];
		const sink: ObservedRulesSink = {
			propose: ({ drafts }) => proposed.push(...drafts),
		};
		await reviewPrCore({
			projectId: "proj-rules",
			prNumber: 23,
			diffSource: diffSourceWith("sha-23"),
			grounding: groundingWithRules(["Order total must never be negative"]),
			session,
			rules: { sink, gotchas: [] },
		});
		// The only inferred rule restates an accepted one → nothing proposed.
		expect(proposed).toHaveLength(0);
	});
});
