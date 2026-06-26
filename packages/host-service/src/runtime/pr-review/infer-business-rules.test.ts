import { describe, expect, it } from "bun:test";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import type { PrDiffInput } from "./guide-types.ts";
import {
	buildBusinessRulesPrompt,
	buildObservedRuleDrafts,
	inferBusinessRules,
	parseBusinessRulesReply,
} from "./infer-business-rules.ts";

const DIFF: PrDiffInput = {
	prNumber: 42,
	headSha: "sha-42",
	baseBranch: "main",
	body: "Enforce non-negative order totals",
	files: [
		{
			filename: "src/order.ts",
			status: "modified",
			patch: "@@ -1 +1 @@\n-total\n+Math.max(0, total)",
			additions: 1,
			deletions: 1,
		},
	],
};

describe("buildBusinessRulesPrompt", () => {
	it("includes the diff, grounding, and a strict JSON contract; lists already-recorded rules", () => {
		const prompt = buildBusinessRulesPrompt({
			diff: DIFF,
			practiceText: "Always validate inputs",
			gotchas: ["totals can underflow"],
			accepted: ["Order total must never be negative"],
		});
		expect(prompt).toContain("src/order.ts");
		expect(prompt).toContain("Always validate inputs");
		expect(prompt).toContain("totals can underflow");
		expect(prompt).toContain("ALREADY recorded");
		expect(prompt).toContain("Order total must never be negative");
		expect(prompt).toContain("ONLY a JSON object");
	});
});

describe("parseBusinessRulesReply", () => {
	it("extracts a JSON object wrapped in prose and shape-validates entries", () => {
		const reply =
			'Sure!\n```json\n{ "rules": [ { "rule": "Totals are non-negative", "category": "business-logic", "confidence": 80 }, { "rule": "" }, { "category": "perf" } ] }\n```';
		const parsed = parseBusinessRulesReply(reply);
		expect(parsed).not.toBeNull();
		expect(parsed).toHaveLength(1);
		expect(parsed?.[0]?.rule).toBe("Totals are non-negative");
		expect(parsed?.[0]?.confidence).toBe(80);
	});

	it("defaults an invalid category to undefined (drafts default it to business-logic)", () => {
		const parsed = parseBusinessRulesReply(
			'{ "rules": [ { "rule": "X", "category": "made-up" } ] }',
		);
		expect(parsed?.[0]?.category).toBeUndefined();
	});

	it("returns null when no JSON / no rules array is present", () => {
		expect(parseBusinessRulesReply("no json here")).toBeNull();
		expect(parseBusinessRulesReply('{ "notRules": [] }')).toBeNull();
	});
});

describe("buildObservedRuleDrafts", () => {
	it("redacts rule text, defaults category/confidence, and stamps provenance", () => {
		// An env-style secret assignment (the redactor's `env-secret-assignment`
		// rule masks the value). Deliberately NOT a real provider token shape, so
		// GitHub push-protection doesn't flag the fixture itself.
		const secretAssignment = "API_KEY=hunter2placeholder";
		const drafts = buildObservedRuleDrafts({
			rawRules: [{ rule: `Rotate the ${secretAssignment} on deploy` }],
			accepted: [],
			sourcePrNumber: 9,
		});
		expect(drafts).toHaveLength(1);
		// The secret-looking value is scrubbed (nothing stored unredacted).
		expect(drafts[0]?.rule).not.toContain("hunter2placeholder");
		expect(drafts[0]?.rule).toContain("[REDACTED]");
		expect(drafts[0]?.category).toBe("business-logic");
		expect(drafts[0]?.confidence).toBe(50);
		expect(drafts[0]?.provenance).toBe("Inferred from PR #9");
	});

	it("dedupes against already-accepted rules and within the batch", () => {
		const drafts = buildObservedRuleDrafts({
			rawRules: [
				{ rule: "Order total must never be negative" },
				{ rule: "  ORDER total must NEVER be negative " },
				{ rule: "New invariant" },
			],
			accepted: ["order total must never be negative"],
			sourcePrNumber: 1,
		});
		expect(drafts).toHaveLength(1);
		expect(drafts[0]?.rule).toBe("New invariant");
	});
});

describe("inferBusinessRules (best-effort)", () => {
	const grounding = {
		diff: DIFF,
		practiceText: null,
		gotchas: [] as string[],
		accepted: [] as string[],
		sourcePrNumber: 42,
	};

	it("returns redacted drafts when the session yields a valid reply", async () => {
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () =>
				JSON.stringify({
					rules: [
						{ rule: "Totals are non-negative", category: "business-logic" },
					],
				}),
		};
		const drafts = await inferBusinessRules({ ...grounding, session });
		expect(drafts).toHaveLength(1);
		expect(drafts[0]?.rule).toBe("Totals are non-negative");
	});

	it("returns [] (never throws) when the session declines / errors / is empty", async () => {
		const declines: GuideEnrichmentSession = {
			isAvailable: () => false,
			complete: async () => null,
		};
		expect(
			await inferBusinessRules({ ...grounding, session: declines }),
		).toEqual([]);

		const throws: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => {
				throw new Error("boom");
			},
		};
		expect(await inferBusinessRules({ ...grounding, session: throws })).toEqual(
			[],
		);

		const garbled: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => "not json",
		};
		expect(
			await inferBusinessRules({ ...grounding, session: garbled }),
		).toEqual([]);
	});
});
