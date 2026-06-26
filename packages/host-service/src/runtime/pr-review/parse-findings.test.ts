import { describe, expect, it } from "bun:test";
import {
	anchorLine,
	buildLocalAiFindings,
	parseFindingsReply,
	parseNewSideRanges,
} from "./parse-findings.ts";

/**
 * Wave-6 M1 anti-hallucination / redaction / `@@` line-anchor boundary tests.
 * The model reply is UNTRUSTED, so these lock the whole parse → validate → drop
 * off-diff → redact → anchor pipeline.
 */

const PATCH_A = [
	"@@ -1,3 +1,4 @@",
	" const a = 1;",
	"+const b = 2;",
	" const c = 3;",
	"+const d = 4;",
	" const e = 5;",
].join("\n");

// Two hunks: new-side 10..12 and 40..40 (count omitted ⇒ 1).
const PATCH_B = [
	"@@ -8,3 +10,3 @@",
	" x",
	"+y",
	" z",
	"@@ -38,1 +40 @@",
	"+w",
].join("\n");

describe("parseFindingsReply", () => {
	it("parses a valid {findings:[…]} payload, ignoring surrounding prose/fences", () => {
		const reply = [
			"Sure, here are the findings:",
			"```json",
			JSON.stringify({
				findings: [
					{
						severity: "warning",
						category: "correctness",
						file: "src/a.ts",
						line: 2,
						rationale: "Off-by-one in the loop bound.",
					},
				],
			}),
			"```",
		].join("\n");
		const parsed = parseFindingsReply(reply);
		expect(parsed).not.toBeNull();
		expect(parsed?.length).toBe(1);
		expect(parsed?.[0]?.severity).toBe("warning");
		expect(parsed?.[0]?.category).toBe("correctness");
		expect(parsed?.[0]?.file).toBe("src/a.ts");
		expect(parsed?.[0]?.line).toBe(2);
	});

	it("returns null when there's no JSON / no findings array", () => {
		expect(parseFindingsReply("no json here")).toBeNull();
		expect(parseFindingsReply('{"notFindings": 1}')).toBeNull();
	});

	it("drops entries with an out-of-enum severity or category", () => {
		const reply = JSON.stringify({
			findings: [
				{
					severity: "critical", // not in the enum → dropped
					category: "correctness",
					file: "src/a.ts",
					rationale: "x",
				},
				{
					severity: "info",
					category: "made-up", // not in the enum → dropped
					file: "src/a.ts",
					rationale: "y",
				},
				{
					severity: "info",
					category: "perf",
					file: "src/a.ts",
					rationale: "kept",
				},
			],
		});
		const parsed = parseFindingsReply(reply);
		expect(parsed?.length).toBe(1);
		expect(parsed?.[0]?.rationale).toBe("kept");
	});
});

describe("parseNewSideRanges / anchorLine", () => {
	it("parses NEW-side ranges from @@ hunk headers (count defaults to 1)", () => {
		expect(parseNewSideRanges(PATCH_B)).toEqual([
			{ start: 10, end: 12 },
			{ start: 40, end: 40 },
		]);
	});

	it("keeps a line the hunks cover and drops one they don't", () => {
		expect(anchorLine({ patch: PATCH_B, line: 11 })).toBe(11);
		expect(anchorLine({ patch: PATCH_B, line: 40 })).toBe(40);
		expect(anchorLine({ patch: PATCH_B, line: 99 })).toBeUndefined();
	});

	it("returns undefined for a null patch or absent line (never fabricates)", () => {
		expect(anchorLine({ patch: null, line: 5 })).toBeUndefined();
		expect(anchorLine({ patch: PATCH_A, line: undefined })).toBeUndefined();
	});
});

describe("buildLocalAiFindings", () => {
	const diffFileSet = new Set(["src/a.ts", "src/b.ts"]);
	const patchByFile = new Map<string, string | null>([
		["src/a.ts", PATCH_A],
		["src/b.ts", null],
	]);

	it("drops a finding whose file is NOT in the diff (anti-hallucination)", () => {
		const findings = buildLocalAiFindings({
			rawFindings: [
				{
					severity: "danger",
					category: "security",
					file: "src/not-in-diff.ts",
					rationale: "hallucinated path",
				},
				{
					severity: "info",
					category: "perf",
					file: "src/a.ts",
					rationale: "real path",
				},
			],
			diffFileSet,
			patchByFile,
		});
		expect(findings.length).toBe(1);
		expect(findings[0]?.anchor.file).toBe("src/a.ts");
	});

	it("redacts secrets in the rationale before building the finding", () => {
		const findings = buildLocalAiFindings({
			rawFindings: [
				{
					severity: "warning",
					category: "security",
					file: "src/a.ts",
					rationale:
						"Token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 leaked here.",
				},
			],
			diffFileSet,
			patchByFile,
		});
		expect(findings.length).toBe(1);
		const rationale = findings[0]?.rationale ?? "";
		expect(rationale).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
		expect(rationale).toContain("[REDACTED]");
	});

	it("keeps a hunk-covered line and drops a line outside the hunks", () => {
		const findings = buildLocalAiFindings({
			rawFindings: [
				{
					severity: "warning",
					category: "correctness",
					file: "src/a.ts",
					line: 2, // within 1..4
					rationale: "in range",
				},
				{
					severity: "info",
					category: "perf",
					file: "src/a.ts",
					line: 500, // outside the hunk → line dropped, finding kept file-only
					rationale: "out of range",
				},
			],
			diffFileSet,
			patchByFile,
		});
		expect(findings.length).toBe(2);
		const inRange = findings.find((f) => f.rationale === "in range");
		const outRange = findings.find((f) => f.rationale === "out of range");
		expect(inRange?.anchor.line).toBe(2);
		expect(inRange?.text).toBe("src/a.ts:2");
		expect(outRange?.anchor.line).toBeUndefined();
		expect(outRange?.text).toBe("src/a.ts");
	});

	it("stamps state=open and source=local-ai, and de-dupes identical findings", () => {
		const raw = {
			severity: "info" as const,
			category: "convention" as const,
			file: "src/a.ts",
			rationale: "same thing",
		};
		const findings = buildLocalAiFindings({
			rawFindings: [raw, { ...raw }],
			diffFileSet,
			patchByFile,
		});
		expect(findings.length).toBe(1);
		expect(findings[0]?.state).toBe("open");
		expect(findings[0]?.source).toBe("local-ai");
	});
});
