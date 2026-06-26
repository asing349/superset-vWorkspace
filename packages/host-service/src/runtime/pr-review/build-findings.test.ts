import { describe, expect, it } from "bun:test";
import {
	buildFindingsPrompt,
	classifyRiskFlag,
	deriveBaselineFindings,
} from "./build-findings.ts";
import type { PrDiffInput, PrReviewGuide } from "./guide-types.ts";

/** A guide fixture with a risk-flags section, as buildGuideSkeleton produces. */
function guideWithRiskFlags(): PrReviewGuide {
	return {
		prNumber: 7,
		headSha: "sha-7",
		areaTags: [],
		grounded: false,
		sections: [
			{ id: "at-a-glance", title: "At a glance", items: [{ text: "PR #7" }] },
			{
				id: "risk-flags",
				title: "Risk flags",
				items: [
					{
						text: "Migration touched — review reversibility: drizzle/0001.sql",
						severity: "danger",
						anchor: { file: "drizzle/0001.sql" },
					},
					{
						text: "Auth-sensitive change: packages/auth/login.ts",
						severity: "danger",
						anchor: { file: "packages/auth/login.ts" },
					},
					{
						text: "Removes an export (possible public-API break): src/api.ts",
						severity: "warning",
						anchor: { file: "src/api.ts" },
					},
					{
						text: "Large change set (40 files) — consider splitting review",
						severity: "warning",
					},
				],
			},
		],
	};
}

describe("classifyRiskFlag", () => {
	it("maps auth → security, migration → correctness, else → convention", () => {
		expect(classifyRiskFlag("Auth-sensitive change: x")).toBe("security");
		expect(
			classifyRiskFlag("Migration touched — review reversibility: y"),
		).toBe("correctness");
		expect(
			classifyRiskFlag("Removes an export (possible public-API break): z"),
		).toBe("convention");
		expect(classifyRiskFlag("Large change set (40 files)")).toBe("convention");
	});
});

describe("deriveBaselineFindings", () => {
	it("projects each risk flag onto a baseline finding (severity + category + anchor)", () => {
		const findings = deriveBaselineFindings({ guide: guideWithRiskFlags() });
		expect(findings.length).toBe(4);
		expect(findings.every((f) => f.source === "baseline")).toBe(true);
		expect(findings.every((f) => f.state === "open")).toBe(true);

		const migration = findings[0];
		expect(migration?.severity).toBe("danger");
		expect(migration?.category).toBe("correctness");
		expect(migration?.anchor.file).toBe("drizzle/0001.sql");

		const auth = findings[1];
		expect(auth?.category).toBe("security");

		// A repo-wide flag (no anchor) gets an empty-file anchor so the shape is
		// uniform; it just doesn't jump anywhere in the Diff tab.
		const repoWide = findings[3];
		expect(repoWide?.anchor.file).toBe("");
	});

	it("skips the 'no risk flags raised' sentinel (it isn't an issue)", () => {
		const guide: PrReviewGuide = {
			prNumber: 1,
			headSha: "s",
			areaTags: [],
			grounded: false,
			sections: [
				{
					id: "risk-flags",
					title: "Risk flags",
					items: [
						{ text: "No automated risk flags raised.", severity: "info" },
					],
				},
			],
		};
		expect(deriveBaselineFindings({ guide }).length).toBe(0);
	});

	it("returns no findings when there is no risk-flags section", () => {
		const guide: PrReviewGuide = {
			prNumber: 1,
			headSha: "s",
			areaTags: [],
			grounded: false,
			sections: [{ id: "at-a-glance", title: "At a glance", items: [] }],
		};
		expect(deriveBaselineFindings({ guide }).length).toBe(0);
	});
});

describe("buildFindingsPrompt", () => {
	it("constrains the model to the changed-file set + the strict JSON contract", () => {
		const diff: PrDiffInput = {
			prNumber: 9,
			headSha: "sha-9",
			baseBranch: "main",
			body: "Adds a thing",
			files: [
				{
					filename: "src/a.ts",
					status: "modified",
					patch: "@@ -1 +1 @@\n-a\n+b",
					additions: 1,
					deletions: 1,
				},
			],
		};
		const prompt = buildFindingsPrompt({ diff });
		expect(prompt).toContain("src/a.ts");
		expect(prompt).toContain("info|warning|danger");
		expect(prompt).toContain(
			"correctness|business-logic|convention|security|perf",
		);
		expect(prompt).toContain("ONLY a JSON object");
	});

	it("grounds the review on accepted observed business rules when supplied (M6)", () => {
		const diff: PrDiffInput = {
			prNumber: 9,
			headSha: "sha-9",
			baseBranch: "main",
			body: null,
			files: [
				{
					filename: "src/a.ts",
					status: "modified",
					patch: "@@ -1 +1 @@\n-a\n+b",
					additions: 1,
					deletions: 1,
				},
			],
		};
		const withRules = buildFindingsPrompt({
			diff,
			businessRules: ["Order total must never be negative"],
		});
		expect(withRules).toContain("Known business rules");
		expect(withRules).toContain("Order total must never be negative");
		// Absent when no rules are supplied.
		expect(buildFindingsPrompt({ diff })).not.toContain("Known business rules");
	});
});
