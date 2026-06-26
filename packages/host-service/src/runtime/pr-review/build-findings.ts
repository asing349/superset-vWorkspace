import { randomUUID } from "node:crypto";
import type {
	Finding,
	FindingCategory,
	FindingSeverity,
} from "./findings-types.ts";
import type { GuideItem, PrDiffInput, PrReviewGuide } from "./guide-types.ts";

/**
 * Deterministic baseline findings + the local-AI findings prompt (Wave 6, M1).
 *
 * The deterministic baseline is the ALWAYS-AVAILABLE review result: it reuses
 * the wave-5 guide skeleton's risk/priority heuristics (the `risk-flags`
 * section) and projects each flagged risk onto a {@link Finding}, mapping the
 * flag's severity through and classifying a `category` from the flag. This is
 * what `reviewPr` returns when no local agent is connected (and the floor the
 * local-AI pass adds to).
 */

// ---------------------------------------------------------------------------
// Deterministic baseline (reuse the skeleton's risk heuristics)
// ---------------------------------------------------------------------------

/** The skeleton's "no flags" sentinel — not an issue, so it is not a finding. */
const NO_RISK_SENTINEL = "No automated risk flags raised.";

/**
 * Classify a deterministic risk-flag's text onto a finding `category`. The flag
 * texts are produced by the wave-5 skeleton (`buildRiskFlags`) in this same
 * package, so matching their stable phrasing is a controlled coupling (locked by
 * the baseline test). Anything unmatched defaults to `convention`.
 */
export function classifyRiskFlag(text: string): FindingCategory {
	const t = text.toLowerCase();
	if (t.includes("auth-sensitive")) return "security";
	if (t.includes("migration")) return "correctness";
	return "convention";
}

/**
 * Project the skeleton's `risk-flags` section onto baseline {@link Finding}s. Each
 * flagged risk becomes one finding: severity carried through, category derived,
 * and the flag's file anchor preserved (the baseline is file-level — line anchors
 * come from the local-AI pass). The "no flags raised" sentinel is skipped.
 */
export function deriveBaselineFindings({
	guide,
}: {
	guide: PrReviewGuide;
}): Finding[] {
	const riskSection = guide.sections.find((s) => s.id === "risk-flags");
	if (!riskSection) return [];

	const findings: Finding[] = [];
	for (const item of riskSection.items) {
		if (item.text === NO_RISK_SENTINEL) continue;
		const severity: FindingSeverity = item.severity ?? "info";
		const finding: Finding = {
			id: randomUUID(),
			severity,
			category: classifyRiskFlag(item.text),
			anchor: anchorFromItem(item),
			text: item.text,
			rationale: item.text,
			state: "open",
			source: "baseline",
		};
		findings.push(finding);
	}
	return findings;
}

function anchorFromItem(item: GuideItem): Finding["anchor"] {
	// A risk-flag may be repo-wide (no anchor, e.g. "large change set"); fall back
	// to an empty-file anchor so the shape stays uniform. Repo-wide findings just
	// don't jump anywhere in the Diff tab.
	if (!item.anchor) return { file: "" };
	const anchor: Finding["anchor"] = { file: item.anchor.file };
	if (item.anchor.line !== undefined) anchor.line = item.anchor.line;
	if (item.anchor.symbol !== undefined) anchor.symbol = item.anchor.symbol;
	return anchor;
}

// ---------------------------------------------------------------------------
// Local-AI findings prompt
// ---------------------------------------------------------------------------

/** Max files we enumerate in the prompt (defensive bound on prompt size). */
const MAX_PROMPT_FILES = 40;
/** Max characters of any single file's patch we include in the prompt. */
const MAX_PATCH_CHARS = 2_000;

function renderFileForPrompt(file: PrDiffInput["files"][number]): string {
	const header = `### ${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`;
	if (!file.patch) return `${header}\n(no patch available)`;
	const patch =
		file.patch.length > MAX_PATCH_CHARS
			? `${file.patch.slice(0, MAX_PATCH_CHARS)}\n… (patch truncated)`
			: file.patch;
	return `${header}\n${patch}`;
}

/** Max accepted business rules enumerated in the findings prompt. */
const MAX_PROMPT_BUSINESS_RULES = 12;

/**
 * Build the one-shot local-AI findings prompt. Deterministic + self-contained:
 * the model gets the PR metadata + the changed files' patches, the project's
 * ACCEPTED observed business rules to check the change against (Wave 6, M6 — the
 * compounding grounding), and a STRICT output contract constraining
 * `severity`/`category` to the allowed enums and `file` to the changed-file set.
 * The parser ({@link parseFindingsReply}) re-validates everything regardless —
 * the prompt is guidance, not trust.
 */
export function buildFindingsPrompt({
	diff,
	businessRules = [],
}: {
	diff: PrDiffInput;
	/** Accepted observed business rules (redacted) to ground the review on. */
	businessRules?: readonly string[];
}): string {
	const files = diff.files
		.slice(0, MAX_PROMPT_FILES)
		.map(renderFileForPrompt)
		.join("\n\n");
	const fileNames = diff.files
		.slice(0, MAX_PROMPT_FILES)
		.map((f) => f.filename)
		.join(", ");

	const rulesBlock =
		businessRules.length > 0
			? [
					"",
					"Known business rules / invariants for this project — flag any change",
					"that VIOLATES one (category `business-logic`):",
					...businessRules
						.slice(0, MAX_PROMPT_BUSINESS_RULES)
						.map((rule) => `- ${rule}`),
				]
			: [];

	return [
		"You are an expert code reviewer. Review the following pull request diff and",
		"report concrete, actionable issues in the CHANGED code only. Ground every",
		"finding in a specific changed file (and a NEW-side line number when you can).",
		"Do NOT invent file paths — only reference files from the changed set below.",
		"",
		`PR #${diff.prNumber} → ${diff.baseBranch}`,
		diff.body ? `PR description:\n${diff.body}` : "PR has no description.",
		"",
		`Changed files (you may ONLY reference these): ${fileNames || "(none)"}`,
		...rulesBlock,
		"",
		"Diff:",
		files || "(empty diff)",
		"",
		"Respond with ONLY a JSON object, no prose outside it, of the form:",
		'{ "findings": [ { "severity": "info|warning|danger",',
		'  "category": "correctness|business-logic|convention|security|perf",',
		'  "file": "<one of the changed files>", "line": <new-side line, optional>,',
		'  "symbol": "<symbol, optional>", "rationale": "<one or two sentences>" } ] }',
		"",
		"Rules: `severity` and `category` MUST be from the allowed sets. `file` MUST",
		"be one of the changed files. Omit anything you are unsure about. Keep each",
		"rationale terse and factual. At most 12 findings, highest-severity first.",
	].join("\n");
}
