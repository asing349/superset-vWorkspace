import { randomUUID } from "node:crypto";
import { redactText } from "@superset/memory";
import type {
	Finding,
	FindingAnchor,
	FindingCategory,
	FindingSeverity,
} from "./findings-types.ts";

/**
 * Local-AI findings parser / validator + `@@` line anchoring (Wave 6, M1).
 *
 * The local-AI review pass asks the model for
 * `{ findings: [{ severity, category, file, line?, symbol?, rationale }] }`.
 * Model output is UNTRUSTED, so this module is the whole anti-hallucination /
 * redaction boundary, applied as a pure, unit-testable pipeline:
 *
 *   1. Extract the first balanced JSON object from the reply (models wrap JSON
 *      in prose / code fences) and parse it.
 *   2. Validate each finding: `severity` ∈ {info,warning,danger}, `category` ∈
 *      {correctness,business-logic,convention,security,perf}, `rationale` a
 *      non-empty string. Anything malformed is DROPPED.
 *   3. ANTI-HALLUCINATION: drop any finding whose `file` is not one of the PR
 *      diff's changed files. The model can never invent a path.
 *   4. REDACT every model-authored string (`rationale`, `symbol`) before it
 *      lands in a finding.
 *   5. LINE ANCHORING: a model-supplied `line` is kept ONLY when the file's raw
 *      patch `@@` hunks actually cover it on the NEW side; otherwise the line is
 *      dropped and the finding stays file-anchored. Lines are never fabricated.
 *
 * No model text is ever trusted into an anchor `file` or a `line` — those are
 * always reconciled against the real diff.
 */

const SEVERITIES: ReadonlySet<FindingSeverity> = new Set<FindingSeverity>([
	"info",
	"warning",
	"danger",
]);

const CATEGORIES: ReadonlySet<FindingCategory> = new Set<FindingCategory>([
	"correctness",
	"business-logic",
	"convention",
	"security",
	"perf",
]);

/** Max characters of any single model rationale we accept (defensive cap). */
const MAX_RATIONALE_CHARS = 500;
/** Max characters of a model-supplied symbol name we accept. */
const MAX_SYMBOL_CHARS = 120;
/** Hard cap on how many local-AI findings we accept from one reply. */
const MAX_FINDINGS = 25;

/** A raw, still-untrusted finding object as the model emits it. */
export interface RawFinding {
	severity: FindingSeverity;
	category: FindingCategory;
	file: string;
	line?: number;
	symbol?: string;
	rationale: string;
}

// ---------------------------------------------------------------------------
// JSON extraction (models wrap JSON in prose / code fences)
// ---------------------------------------------------------------------------

/**
 * Extract the first balanced top-level JSON object from a model reply, matching
 * the opening `{` to its closing `}` while respecting string literals. Returns
 * null when no object is found. (Mirrors the wave-5 enrich-guide extractor; kept
 * local so the wave-5 module stays untouched.)
 */
function extractJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Parse + shape-validate the reply into RawFinding[]
// ---------------------------------------------------------------------------

function toRawFinding(value: unknown): RawFinding | null {
	if (typeof value !== "object" || value === null) return null;
	const obj = value as Record<string, unknown>;

	const { severity, category } = obj;
	if (
		typeof severity !== "string" ||
		!SEVERITIES.has(severity as FindingSeverity)
	) {
		return null;
	}
	if (
		typeof category !== "string" ||
		!CATEGORIES.has(category as FindingCategory)
	) {
		return null;
	}
	if (typeof obj.file !== "string" || obj.file.trim().length === 0) return null;
	if (typeof obj.rationale !== "string" || obj.rationale.trim().length === 0) {
		return null;
	}

	const raw: RawFinding = {
		severity: severity as FindingSeverity,
		category: category as FindingCategory,
		file: obj.file.trim(),
		rationale: obj.rationale.trim(),
	};
	if (
		typeof obj.line === "number" &&
		Number.isInteger(obj.line) &&
		obj.line > 0
	) {
		raw.line = obj.line;
	}
	if (typeof obj.symbol === "string" && obj.symbol.trim().length > 0) {
		raw.symbol = obj.symbol.trim();
	}
	return raw;
}

/**
 * Parse + shape-validate a model reply into `RawFinding[]`. Returns null when no
 * JSON object / `findings` array is found; returns `[]` when the array is present
 * but every entry was malformed. Does NOT yet check the diff file set or redact —
 * that is {@link buildLocalAiFindings}'s job.
 */
export function parseFindingsReply(reply: string): RawFinding[] | null {
	const json = extractJsonObject(reply);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const findings = (parsed as Record<string, unknown>).findings;
	if (!Array.isArray(findings)) return null;

	const raw: RawFinding[] = [];
	for (const entry of findings) {
		const candidate = toRawFinding(entry);
		if (candidate) raw.push(candidate);
		if (raw.length >= MAX_FINDINGS) break;
	}
	return raw;
}

// ---------------------------------------------------------------------------
// `@@` hunk-header line anchoring (NEW-side)
// ---------------------------------------------------------------------------

/** One NEW-side line range a unified-diff hunk header declares. */
interface NewSideRange {
	start: number;
	end: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a raw unified-diff patch's `@@ -a,b +c,d @@` headers into the NEW-side
 * line ranges they cover (`c .. c+d-1`; `d` defaults to 1 when omitted). This is
 * the ONLY source of truth for which lines a finding may anchor to.
 */
export function parseNewSideRanges(patch: string): NewSideRange[] {
	const ranges: NewSideRange[] = [];
	for (const line of patch.split("\n")) {
		const match = HUNK_HEADER.exec(line);
		if (!match) continue;
		const start = Number.parseInt(match[1] ?? "", 10);
		if (!Number.isInteger(start)) continue;
		const countRaw = match[2];
		const count = countRaw === undefined ? 1 : Number.parseInt(countRaw, 10);
		const span = Number.isInteger(count) && count > 0 ? count : 1;
		ranges.push({ start, end: start + span - 1 });
	}
	return ranges;
}

/**
 * Resolve a model-supplied `line` against a file's raw patch. Returns the line
 * ONLY when the patch's `@@` hunks cover it on the NEW side; otherwise undefined
 * (the finding stays file-anchored). A null/absent patch or line ⇒ undefined: we
 * never fabricate a line the diff can't back.
 */
export function anchorLine({
	patch,
	line,
}: {
	patch: string | null;
	line: number | undefined;
}): number | undefined {
	if (line === undefined || patch === null) return undefined;
	for (const range of parseNewSideRanges(patch)) {
		if (line >= range.start && line <= range.end) return line;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Validate + redact + anchor → Finding[]
// ---------------------------------------------------------------------------

export interface BuildLocalAiFindingsInput {
	rawFindings: readonly RawFinding[];
	/** Every changed file in the PR diff (incl. rename `previousFilename`). */
	diffFileSet: ReadonlySet<string>;
	/** filename → raw unified-diff patch (null for binary / too-large files). */
	patchByFile: ReadonlyMap<string, string | null>;
}

function buildHeadline(file: string, line: number | undefined): string {
	return line === undefined ? file : `${file}:${line}`;
}

function dedupeKey(finding: Finding): string {
	return [
		finding.anchor.file,
		finding.anchor.line ?? "",
		finding.category,
		finding.rationale,
	].join(" ");
}

/**
 * Turn shape-valid `RawFinding[]` into trusted `Finding[]`: drop off-diff files
 * (anti-hallucination), redact all model text, anchor lines via the `@@` hunks,
 * and de-duplicate identical findings. Pure + deterministic apart from the UUID
 * id. The result carries `state: "open"` and `source: "local-ai"`.
 */
export function buildLocalAiFindings(
	input: BuildLocalAiFindingsInput,
): Finding[] {
	const { rawFindings, diffFileSet, patchByFile } = input;
	const out: Finding[] = [];
	const seen = new Set<string>();

	for (const raw of rawFindings) {
		// Anti-hallucination: the file MUST be one the PR diff actually changed.
		if (!diffFileSet.has(raw.file)) continue;

		const patch = patchByFile.get(raw.file) ?? null;
		const line = anchorLine({ patch, line: raw.line });

		const anchor: FindingAnchor = { file: raw.file };
		if (line !== undefined) anchor.line = line;
		if (raw.symbol !== undefined) {
			anchor.symbol = redactText(raw.symbol).text.slice(0, MAX_SYMBOL_CHARS);
		}

		const rationale = redactText(raw.rationale).text.slice(
			0,
			MAX_RATIONALE_CHARS,
		);

		const finding: Finding = {
			id: randomUUID(),
			severity: raw.severity,
			category: raw.category,
			anchor,
			text: buildHeadline(raw.file, line),
			rationale,
			state: "open",
			source: "local-ai",
		};

		const key = dedupeKey(finding);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(finding);
	}

	return out;
}
