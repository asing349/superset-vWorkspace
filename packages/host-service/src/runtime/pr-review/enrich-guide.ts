import { redactText } from "@superset/memory";
import type {
	GuideItem,
	GuideSection,
	GuideSectionId,
	PrDiffInput,
	PrReviewGuide,
} from "./guide-types.ts";

/**
 * Local-AI guide enrichment (Wave 5, M4 — the novel part).
 *
 * `enrichGuide` takes the deterministic M3 skeleton and, IF a LOCAL AI session
 * is available, runs ONE one-shot prompt over the diff + skeleton + grounding
 * and merges the model's prose back into the guide. It is BEST-EFFORT by
 * construction:
 *
 *   - No local session available  → return the M3 skeleton UNCHANGED.
 *   - The session errors / times out / returns junk → return the skeleton
 *     UNCHANGED (NEVER throws).
 *   - The session returns usable prose → merge it in WHILE PRESERVING every
 *     `{ file, line?, symbol? }` anchor the skeleton already carries.
 *
 * NO new Superset cloud model call: the session is the user's OWN on-device /
 * connected agent, injected as a narrow PORT so this is unit-testable with a
 * mock and so the streaming/polling glue to `ctx.runtime.chat` lives elsewhere
 * (the generate-guide orchestrator builds the adapter).
 *
 * Anchor preservation is STRUCTURAL, not trust-based: the model is only allowed
 * to contribute (a) a free-text overview paragraph and (b) a one-line note per
 * EXISTING anchored item, keyed by a stable item id. We never let the model add,
 * drop, or rewrite anchors — we re-attach the original anchors ourselves.
 */

// ---------------------------------------------------------------------------
// Injected session port (satisfied by a ctx.runtime.chat adapter in M4 wiring)
// ---------------------------------------------------------------------------

/**
 * A local AI session the enrichment can use. Both methods are best-effort:
 * `isAvailable` reports whether a local model/agent is connected at all (so we
 * skip the whole prompt when none is), and `complete` runs one prompt and
 * returns the assistant's text — or `null` on any failure (the adapter swallows
 * streaming/poll errors and surfaces null rather than throwing).
 */
export interface GuideEnrichmentSession {
	/** True when a local model/agent is connected and usable. */
	isAvailable(): Promise<boolean> | boolean;
	/** Run ONE prompt; resolve to the reply text, or null on any failure. */
	complete(input: {
		prompt: string;
		signal?: AbortSignal;
	}): Promise<string | null>;
}

export interface EnrichGuideInput {
	skeleton: PrReviewGuide;
	diff: PrDiffInput;
	session: GuideEnrichmentSession;
	/** Optional abort signal threaded to the session. */
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Enrichment payload contract (what the model must return)
// ---------------------------------------------------------------------------

/**
 * The STRICT JSON shape the enrichment prompt asks the model to emit. Anything
 * else (extra keys, prose outside the JSON, malformed JSON) is ignored and the
 * skeleton is returned unchanged. Keeping the model to overview + keyed notes —
 * never raw anchors — is what makes anchor preservation structural.
 */
interface EnrichmentPayload {
	/** A 1-3 sentence reviewer-facing overview of the change. */
	overview?: string;
	/** Per-item notes keyed by the stable item id we hand the model. */
	notes?: Record<string, string>;
}

/** Max characters of model overview we accept (defensive cap). */
const MAX_OVERVIEW_CHARS = 800;
/** Max characters of any single per-item note we accept. */
const MAX_NOTE_CHARS = 280;
/** The synthetic section id used to host the model's overview. */
const OVERVIEW_SECTION_ID: GuideSectionId = "at-a-glance";

// ---------------------------------------------------------------------------
// Stable item ids (anchor-preservation key)
// ---------------------------------------------------------------------------

/**
 * Deterministic, stable id for an item within a section: `${sectionId}#${index}`.
 * We hand these to the model and read its notes back by the SAME id, so a note
 * always lands on the item whose anchor we then re-attach unchanged.
 */
function itemId(sectionId: GuideSectionId, index: number): string {
	return `${sectionId}#${index}`;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/** Render the skeleton's anchored items as an id-labelled list for the prompt. */
function renderItemsForPrompt(sections: readonly GuideSection[]): string {
	const lines: string[] = [];
	for (const section of sections) {
		section.items.forEach((item, index) => {
			// Only items that point at code are worth a per-item note.
			if (!item.anchor) return;
			lines.push(`${itemId(section.id, index)}: ${item.text}`);
		});
	}
	return lines.join("\n");
}

/**
 * Build the one-shot enrichment prompt. Deterministic and self-contained: the
 * model gets the PR metadata, the deterministic sections, and a strict
 * output contract. It is told NOT to invent anchors — only overview + notes.
 */
export function buildEnrichmentPrompt(input: {
	skeleton: PrReviewGuide;
	diff: PrDiffInput;
}): string {
	const { skeleton, diff } = input;
	const fileList = diff.files
		.slice(0, 40)
		.map((f) => `- ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`)
		.join("\n");
	const itemList = renderItemsForPrompt(skeleton.sections);

	return [
		"You are reviewing a pull request. Write a concise reviewer-facing overview",
		"and, optionally, a one-line note for specific changed-code items.",
		"",
		`PR #${diff.prNumber} → ${diff.baseBranch}`,
		diff.body ? `PR description:\n${diff.body}` : "PR has no description.",
		"",
		"Changed files:",
		fileList || "(none)",
		"",
		"Anchored items you may annotate (use the EXACT id):",
		itemList || "(none)",
		"",
		"Respond with ONLY a JSON object, no prose outside it, of the form:",
		'{ "overview": "<1-3 sentences>", "notes": { "<itemId>": "<one line>" } }',
		"Do not invent file paths or anchors. Only annotate ids listed above.",
		"Omit any note you are unsure about. Keep it terse and factual.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Parsing the model reply (defensive)
// ---------------------------------------------------------------------------

/**
 * Extract the first balanced top-level JSON object from a model reply. Models
 * often wrap JSON in prose or code fences; we scan for the first `{` and match
 * to its closing `}` (respecting string literals) so fenced/wrapped output
 * still parses. Returns null when no object is found.
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

/** Parse + validate the model reply into an `EnrichmentPayload` (or null). */
export function parseEnrichmentReply(reply: string): EnrichmentPayload | null {
	const json = extractJsonObject(reply);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const obj = parsed as Record<string, unknown>;

	const payload: EnrichmentPayload = {};
	if (typeof obj.overview === "string" && obj.overview.trim().length > 0) {
		payload.overview = obj.overview.trim().slice(0, MAX_OVERVIEW_CHARS);
	}
	if (typeof obj.notes === "object" && obj.notes !== null) {
		const notes: Record<string, string> = {};
		for (const [key, value] of Object.entries(obj.notes)) {
			if (typeof value === "string" && value.trim().length > 0) {
				notes[key] = value.trim().slice(0, MAX_NOTE_CHARS);
			}
		}
		if (Object.keys(notes).length > 0) payload.notes = notes;
	}
	return payload.overview || payload.notes ? payload : null;
}

// ---------------------------------------------------------------------------
// Merge (anchor-preserving)
// ---------------------------------------------------------------------------

/**
 * Merge the model payload into the skeleton. Pure + anchor-preserving:
 *   - The overview is appended as a NEW, anchor-less item to the at-a-glance
 *     section, prefixed so the renderer can style it.
 *   - Each note is appended to the `text` of the EXACT item it keys, and the
 *     original `anchor` (and severity/href) is re-attached unchanged.
 * The model can never add/move/rewrite anchors — we only ever read its text.
 * All merged text is redacted before it lands in the guide.
 */
export function mergeEnrichment(input: {
	skeleton: PrReviewGuide;
	payload: EnrichmentPayload;
}): PrReviewGuide {
	const { skeleton, payload } = input;
	const overview = payload.overview ? redactText(payload.overview).text : null;
	const notes = payload.notes ?? {};

	const sections: GuideSection[] = skeleton.sections.map((section) => {
		const items: GuideItem[] = section.items.map((item, index) => {
			const note = notes[itemId(section.id, index)];
			if (!note || !item.anchor) return item;
			const safeNote = redactText(note).text;
			// Re-attach the ORIGINAL anchor (+ severity/href) unchanged; only the
			// human text gains the model's note.
			return { ...item, text: `${item.text} — ${safeNote}` };
		});

		if (section.id === OVERVIEW_SECTION_ID && overview) {
			return {
				...section,
				items: [{ text: `Overview: ${overview}` }, ...items],
			};
		}
		return { ...section, items };
	});

	return { ...skeleton, sections, enriched: true };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Best-effort enrich the M3 skeleton via a local AI session. Returns the
 * skeleton UNCHANGED when no session is available or anything fails; never
 * throws. On success, returns an anchor-preserving, redacted, enriched guide.
 */
export async function enrichGuide(
	input: EnrichGuideInput,
): Promise<PrReviewGuide> {
	const { skeleton, diff, session, signal } = input;
	try {
		if (!(await session.isAvailable())) return skeleton;

		const prompt = buildEnrichmentPrompt({ skeleton, diff });
		const reply = await session.complete({ prompt, signal });
		if (!reply) return skeleton;

		const payload = parseEnrichmentReply(reply);
		if (!payload) return skeleton;

		return mergeEnrichment({ skeleton, payload });
	} catch {
		// Best-effort: any failure degrades to the deterministic skeleton.
		return skeleton;
	}
}
