import { redactText } from "@superset/memory";
import type {
	ObservedRule,
	ObservedRuleDraft,
} from "./business-rules-types.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import type { FindingCategory } from "./findings-types.ts";
import type { PrDiffInput } from "./guide-types.ts";

/**
 * Observed business-rules INFERENCE (Wave 6, M6) — the local-AI pass that, at
 * review time, infers domain rules/invariants from the PR (body + diff) grounded
 * by the project's practice + playbook gotchas, then redacts + shapes them into
 * `proposed` drafts for the curation store. Runs ONLY during an explicit Review-
 * PR mutation, through the user's OWN local AI session (no new cloud call), and
 * is best-effort — any failure yields `[]` and the review proceeds.
 *
 * Model output is UNTRUSTED, so this module is the whole redaction/validation
 * boundary (mirroring `parse-findings.ts`): extract JSON → shape-validate →
 * REDACT every rule string → dedupe (within the batch + against already-accepted
 * rules) → cap. Nothing is auto-accepted; the developer curates.
 */

const VALID_CATEGORIES: ReadonlySet<FindingCategory> = new Set<FindingCategory>(
	["correctness", "business-logic", "convention", "security", "perf"],
);

/** Max characters of a rule we accept (defensive cap). */
const MAX_RULE_CHARS = 280;
/** Hard cap on how many rules we accept from one reply. */
const MAX_RULES = 12;
/** Default confidence when the model omits one. */
const DEFAULT_CONFIDENCE = 50;
/** Max changed-file patches enumerated in the prompt (prompt-size bound). */
const MAX_PROMPT_FILES = 30;
/** Max characters of any single file's patch in the prompt. */
const MAX_PATCH_CHARS = 1_500;
/** Max grounding gotchas / accepted rules enumerated in the prompt. */
const MAX_GROUNDING_LINES = 12;

/** A raw, still-untrusted rule object as the model emits it. */
export interface RawObservedRule {
	rule: string;
	category?: FindingCategory;
	confidence?: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function renderFileForPrompt(file: PrDiffInput["files"][number]): string {
	const header = `### ${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`;
	if (!file.patch) return `${header}\n(no patch available)`;
	const patch =
		file.patch.length > MAX_PATCH_CHARS
			? `${file.patch.slice(0, MAX_PATCH_CHARS)}\n… (patch truncated)`
			: file.patch;
	return `${header}\n${patch}`;
}

/**
 * Build the one-shot business-rules inference prompt. Self-contained: the model
 * gets the PR metadata + changed-file patches, the project's coding practice +
 * prior playbook gotchas (grounding), and the rules it has ALREADY accepted (so
 * it surfaces NEW invariants, not restatements). The output contract is a strict
 * JSON object the parser re-validates regardless.
 */
export function buildBusinessRulesPrompt({
	diff,
	practiceText,
	gotchas,
	accepted,
}: {
	diff: PrDiffInput;
	practiceText: string | null;
	gotchas: readonly string[];
	accepted: readonly string[];
}): string {
	const files = diff.files
		.slice(0, MAX_PROMPT_FILES)
		.map(renderFileForPrompt)
		.join("\n\n");

	const groundingLines: string[] = [];
	if (practiceText && practiceText.trim().length > 0) {
		groundingLines.push(
			`Project coding practice (excerpt):\n${practiceText.slice(0, 800)}`,
		);
	}
	if (gotchas.length > 0) {
		groundingLines.push(
			`Known gotchas from prior work:\n${gotchas
				.slice(0, MAX_GROUNDING_LINES)
				.map((g) => `- ${g}`)
				.join("\n")}`,
		);
	}
	if (accepted.length > 0) {
		groundingLines.push(
			`Business rules ALREADY recorded (do NOT restate these):\n${accepted
				.slice(0, MAX_GROUNDING_LINES)
				.map((r) => `- ${r}`)
				.join("\n")}`,
		);
	}

	return [
		"You are an expert reviewer building a project's memory of its DOMAIN BUSINESS",
		"RULES and INVARIANTS — durable constraints the code must uphold (e.g. 'an",
		"order total must never be negative', 'sessions expire after 30 days'). From",
		"the pull request below, infer NEW business rules/invariants this change",
		"reveals or depends on. Report only durable domain rules — NOT code-style or",
		"one-off review nits, and NOT rules already recorded below.",
		"",
		`PR #${diff.prNumber} → ${diff.baseBranch}`,
		diff.body ? `PR description:\n${diff.body}` : "PR has no description.",
		"",
		groundingLines.join("\n\n"),
		"",
		"Diff:",
		files || "(empty diff)",
		"",
		"Respond with ONLY a JSON object, no prose outside it, of the form:",
		'{ "rules": [ { "rule": "<one durable invariant, one sentence>",',
		'  "category": "business-logic|correctness|security|convention|perf",',
		'  "confidence": <0-100, optional> } ] }',
		"",
		"Rules: each `rule` is ONE durable domain invariant in plain language; omit",
		"anything you are unsure about; at most 8 rules, highest-confidence first.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Parse (untrusted reply → RawObservedRule[])
// ---------------------------------------------------------------------------

/**
 * Extract the first balanced top-level JSON object from a model reply, matching
 * the opening `{` to its closing `}` while respecting string literals. (A local
 * copy of the parse-findings extractor so that module stays untouched.)
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

function toRawObservedRule(value: unknown): RawObservedRule | null {
	if (typeof value !== "object" || value === null) return null;
	const obj = value as Record<string, unknown>;
	if (typeof obj.rule !== "string" || obj.rule.trim().length === 0) return null;

	const raw: RawObservedRule = { rule: obj.rule.trim() };
	if (
		typeof obj.category === "string" &&
		VALID_CATEGORIES.has(obj.category as FindingCategory)
	) {
		raw.category = obj.category as FindingCategory;
	}
	if (
		typeof obj.confidence === "number" &&
		Number.isFinite(obj.confidence) &&
		obj.confidence >= 0 &&
		obj.confidence <= 100
	) {
		raw.confidence = Math.round(obj.confidence);
	}
	return raw;
}

/**
 * Parse + shape-validate a model reply into `RawObservedRule[]`. Returns null
 * when no JSON object / `rules` array is found; `[]` when present but every entry
 * was malformed. Does NOT redact or dedupe — that is {@link buildObservedRuleDrafts}.
 */
export function parseBusinessRulesReply(
	reply: string,
): RawObservedRule[] | null {
	const json = extractJsonObject(reply);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const rules = (parsed as Record<string, unknown>).rules;
	if (!Array.isArray(rules)) return null;

	const out: RawObservedRule[] = [];
	for (const entry of rules) {
		const candidate = toRawObservedRule(entry);
		if (candidate) out.push(candidate);
		if (out.length >= MAX_RULES) break;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Redact + dedupe → ObservedRuleDraft[]
// ---------------------------------------------------------------------------

function normalizeRuleText(rule: string): string {
	return rule.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Turn shape-valid `RawObservedRule[]` into trusted `ObservedRuleDraft[]`: REDACT
 * every rule string (Assumption A3/A5 — nothing stored unredacted), default the
 * category/confidence, and dedupe within the batch + against the already-accepted
 * rules (so re-review doesn't re-propose a known rule). Pure + deterministic.
 */
export function buildObservedRuleDrafts({
	rawRules,
	accepted,
	sourcePrNumber,
}: {
	rawRules: readonly RawObservedRule[];
	accepted: readonly string[];
	sourcePrNumber: number | null;
}): ObservedRuleDraft[] {
	const seen = new Set(accepted.map(normalizeRuleText));
	const out: ObservedRuleDraft[] = [];
	const provenance =
		sourcePrNumber !== null ? `Inferred from PR #${sourcePrNumber}` : null;

	for (const raw of rawRules) {
		const redacted = redactText(raw.rule).text.trim().slice(0, MAX_RULE_CHARS);
		if (redacted.length === 0) continue;
		const key = normalizeRuleText(redacted);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			rule: redacted,
			category: raw.category ?? "business-logic",
			confidence: raw.confidence ?? DEFAULT_CONFIDENCE,
			provenance,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Best-effort orchestration
// ---------------------------------------------------------------------------

/**
 * Best-effort local-AI business-rules inference. Returns `[]` (never throws) when
 * no session is available, the session declines/errors/times out, or the reply
 * doesn't parse — the review proceeds regardless. All redaction + dedupe happens
 * in {@link buildObservedRuleDrafts}.
 */
export async function inferBusinessRules({
	diff,
	session,
	practiceText,
	gotchas,
	accepted,
	sourcePrNumber,
	signal,
}: {
	diff: PrDiffInput;
	session: GuideEnrichmentSession;
	practiceText: string | null;
	gotchas: readonly string[];
	/** Already-accepted rule texts (grounding + dedupe). */
	accepted: readonly string[];
	sourcePrNumber: number | null;
	signal?: AbortSignal;
}): Promise<ObservedRuleDraft[]> {
	try {
		if (!(await session.isAvailable())) return [];
		const prompt = buildBusinessRulesPrompt({
			diff,
			practiceText,
			gotchas,
			accepted,
		});
		const reply = await session.complete({ prompt, signal });
		if (!reply) return [];
		const parsed = parseBusinessRulesReply(reply);
		if (!parsed) return [];
		return buildObservedRuleDrafts({
			rawRules: parsed,
			accepted,
			sourcePrNumber,
		});
	} catch {
		// Best-effort: any failure leaves the observed-rules layer unchanged.
		return [];
	}
}

/** Reduce accepted `ObservedRule`s to their rule texts (grounding + dedupe). */
export function acceptedRuleTexts(
	rules: readonly Pick<ObservedRule, "rule">[],
): string[] {
	return rules.map((rule) => rule.rule);
}
