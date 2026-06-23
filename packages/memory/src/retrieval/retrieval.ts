import { pathsToAreas, pathToAreas } from "../path-to-area";
import { rankByAreaAndRecency } from "../ranking";
import type { AreaTag, Playbook, ProjectIndexEntry } from "../types";

/**
 * Retrieval-bundle assembly (PURE LOGIC, B4). Given the candidate playbooks +
 * index entries + practice docs already loaded by the host, this assembles a
 * SMALL, high-signal bundle for the current intent: derive the query's areas,
 * area-filter + rank candidates, and enforce a token cap by trimming the
 * lowest-ranked items first. No Node deps, no I/O — the host supplies the data.
 */

/** A practice slice included in the bundle (project + global). */
export interface PracticeSlice {
	scope: "project" | "global";
	content: string;
	version: number | null;
}

/** A ranked playbook in the bundle (lean projection, not the full row). */
export interface BundlePlaybook {
	id: string;
	intent: string;
	areaTags: AreaTag[];
	commands: string[];
	gotcha: string | null;
	diffShape: string | null;
	validation: string | null;
	status: Playbook["status"];
	confidence: number;
	score: number;
}

/** A ranked project-index slice in the bundle. */
export interface BundleIndexSlice {
	path: string;
	areaTags: AreaTag[];
	summary: string | null;
	score: number;
}

/**
 * A semantically-retrieved slice (B7). Only present when local embeddings are
 * enabled+available; the host supplies these pre-ranked by cosine similarity.
 * Identical in shape to an index slice plus the similarity score so the agent
 * can tell semantic recall from lexical/area recall.
 */
export interface BundleSemanticSlice {
	path: string;
	summary: string | null;
	/** Cosine similarity to the query embedding, in [-1, 1]. */
	similarity: number;
}

/** The assembled retrieval bundle returned to the agent (over MCP or push). */
export interface RetrievalBundle {
	/** Areas the query resolved to (derived from intent + explicit areas). */
	queryAreas: AreaTag[];
	practices: PracticeSlice[];
	playbooks: BundlePlaybook[];
	indexSlices: BundleIndexSlice[];
	/**
	 * Semantic recall slices (B7). Empty unless local embeddings are
	 * enabled+available — when off this is always `[]` and the rest of the
	 * bundle is identical to the lexical/area-only result.
	 */
	semanticSlices: BundleSemanticSlice[];
	/** Estimated tokens of the (possibly trimmed) bundle. */
	estimatedTokens: number;
	/** Estimated tokens BEFORE the size cap trimmed anything. */
	estimatedTokensBeforeCap: number;
	/** True when the size cap dropped at least one item. */
	trimmed: boolean;
}

export interface AssembleBundleInput {
	intent: string;
	/** Explicit area hints to union with the derived areas. */
	explicitAreas?: readonly AreaTag[];
	/** Candidate playbooks (host pre-filters by project + status). */
	playbooks: readonly Playbook[];
	/** Candidate index entries (host pre-filters by project). */
	indexEntries: readonly ProjectIndexEntry[];
	/** Practice docs to include verbatim (already scope-resolved). */
	practices?: readonly PracticeSlice[];
	/**
	 * Pre-ranked semantic slices (B7). Supplied by the host ONLY when local
	 * embeddings are enabled+available; omitted/empty otherwise (→ off path is
	 * byte-identical to the lexical/area-only bundle, minus the empty array).
	 */
	semanticSlices?: readonly BundleSemanticSlice[];
	/** Max playbooks to keep after ranking. Default 5. */
	topKPlaybooks?: number;
	/** Max index slices to keep after ranking. Default 10. */
	topKIndexSlices?: number;
	/** Token budget for the whole bundle. Default 2000. */
	maxTokens?: number;
	/** Reference "now" for recency. Default Date.now(). */
	now?: number;
}

const DEFAULT_TOP_K_PLAYBOOKS = 5;
const DEFAULT_TOP_K_INDEX = 10;
const DEFAULT_MAX_TOKENS = 2000;

/**
 * Cheap, deterministic token estimate: ~4 chars/token (the common GPT/Claude
 * heuristic), min 1 for non-empty input. No tokenizer dependency (egress-free,
 * and exact counts aren't needed for a budget).
 */
export function estimateTokens(text: string): number {
	if (text.length === 0) return 0;
	return Math.max(1, Math.ceil(text.length / 4));
}

/** Derive the query's area set from free-text intent + explicit area hints. */
export function deriveQueryAreas(options: {
	intent: string;
	explicitAreas?: readonly AreaTag[];
}): AreaTag[] {
	const areas = new Set<AreaTag>(options.explicitAreas ?? []);

	// Pull any path-looking tokens out of the intent and map them to areas.
	const pathTokens = options.intent.match(/[\w./-]*\/[\w./-]+/g) ?? [];
	for (const token of pathTokens) {
		for (const area of pathToAreas(token)) {
			if (area !== "other") areas.add(area);
		}
	}

	// Keyword → area hints for common phrasing without explicit paths.
	const lower = options.intent.toLowerCase();
	const KEYWORD_AREAS: ReadonlyArray<[RegExp, AreaTag]> = [
		[/\b(frontend|react|component|ui|css|tailwind)\b/, "frontend"],
		[/\b(backend|server|api|endpoint|route|trpc)\b/, "backend"],
		[/\b(schema|migration|drizzle|database|table|column)\b/, "schema"],
		[/\b(design system|shadcn)\b/, "design-system"],
		[/\b(desktop|electron|renderer)\b/, "desktop"],
		[/\b(mobile|expo|react native)\b/, "mobile"],
		[/\b(auth|login|clerk|session|token)\b/, "auth"],
		[/\b(mcp|model context protocol)\b/, "mcp"],
		[/\b(test|spec|vitest|bun test)\b/, "tests"],
	];
	for (const [re, area] of KEYWORD_AREAS) {
		if (re.test(lower)) areas.add(area);
	}

	return areas.size > 0 ? [...areas] : ["other"];
}

function toBundlePlaybook(playbook: Playbook, score: number): BundlePlaybook {
	return {
		id: playbook.id,
		intent: playbook.intent,
		areaTags: playbook.areaTags,
		commands: playbook.commands,
		gotcha: playbook.gotcha,
		diffShape: playbook.diffShape,
		validation: playbook.validation,
		status: playbook.status,
		confidence: playbook.confidence,
		score,
	};
}

/** Rough token weight of one bundle playbook (its text fields). */
function playbookTokens(playbook: BundlePlaybook): number {
	const text = [
		playbook.intent,
		playbook.commands.join(" "),
		playbook.gotcha ?? "",
		playbook.diffShape ?? "",
		playbook.validation ?? "",
	].join(" ");
	return estimateTokens(text);
}

function indexSliceTokens(slice: BundleIndexSlice): number {
	return estimateTokens(`${slice.path} ${slice.summary ?? ""}`);
}

function semanticSliceTokens(slice: BundleSemanticSlice): number {
	return estimateTokens(`${slice.path} ${slice.summary ?? ""}`);
}

function practiceTokens(slice: PracticeSlice): number {
	return estimateTokens(slice.content);
}

/**
 * Assemble the retrieval bundle: derive areas, area-filter + rank playbooks and
 * index slices, then enforce the token cap by trimming lowest-ranked items
 * first (index slices before playbooks; practices are kept — they are the
 * highest-signal durable layer — unless they alone exceed the budget).
 */
export function assembleRetrievalBundle(
	input: AssembleBundleInput,
): RetrievalBundle {
	const now = input.now ?? Date.now();
	const queryAreas = deriveQueryAreas({
		intent: input.intent,
		explicitAreas: input.explicitAreas,
	});
	const topKPlaybooks = input.topKPlaybooks ?? DEFAULT_TOP_K_PLAYBOOKS;
	const topKIndex = input.topKIndexSlices ?? DEFAULT_TOP_K_INDEX;
	const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

	// Area filter: keep candidates that share at least one area with the query
	// (unless the query is the catch-all "other", in which case keep all).
	const areaSet = new Set(queryAreas);
	const matchesArea = (tags: readonly AreaTag[]): boolean =>
		areaSet.has("other") || tags.some((tag) => areaSet.has(tag));

	const playbookCandidates = input.playbooks.filter((p) =>
		matchesArea(p.areaTags),
	);
	const rankedPlaybooks = rankByAreaAndRecency(playbookCandidates, {
		queryAreas,
		topK: topKPlaybooks,
		now,
	}).map(({ item, score }) => toBundlePlaybook(item, score));

	const indexCandidates = input.indexEntries.filter((e) =>
		matchesArea(e.areaTags),
	);
	const rankedIndex = rankByAreaAndRecency(indexCandidates, {
		queryAreas,
		topK: topKIndex,
		now,
	}).map(({ item, score }) => ({
		path: item.path,
		areaTags: item.areaTags,
		summary: item.summary,
		score,
	}));

	const practices = [...(input.practices ?? [])];
	// Semantic slices arrive pre-ranked (highest similarity first). Empty when
	// embeddings are off → the off path produces the same bundle as before B7.
	const semantic = [...(input.semanticSlices ?? [])];

	// Token accounting before the cap.
	const practiceTotal = practices.reduce(
		(sum, p) => sum + practiceTokens(p),
		0,
	);
	const playbookTotal = rankedPlaybooks.reduce(
		(sum, p) => sum + playbookTokens(p),
		0,
	);
	const indexTotal = rankedIndex.reduce(
		(sum, s) => sum + indexSliceTokens(s),
		0,
	);
	const semanticTotal = semantic.reduce(
		(sum, s) => sum + semanticSliceTokens(s),
		0,
	);
	const estimatedTokensBeforeCap =
		practiceTotal + playbookTotal + indexTotal + semanticTotal;

	// Trim to budget: drop lowest-ranked SEMANTIC slices first, then lexical
	// index slices, then lowest-ranked playbooks. Practices are kept (durable,
	// highest-signal) unless they alone blow the budget — then trim them last,
	// lowest-version first.
	let keptPlaybooks = rankedPlaybooks;
	let keptIndex = rankedIndex;
	let keptSemantic = semantic;
	let keptPractices = practices;
	let trimmed = false;

	const total = () =>
		keptPractices.reduce((s, p) => s + practiceTokens(p), 0) +
		keptPlaybooks.reduce((s, p) => s + playbookTokens(p), 0) +
		keptIndex.reduce((s, p) => s + indexSliceTokens(p), 0) +
		keptSemantic.reduce((s, p) => s + semanticSliceTokens(p), 0);

	while (total() > maxTokens && keptSemantic.length > 0) {
		keptSemantic = keptSemantic.slice(0, -1);
		trimmed = true;
	}
	while (total() > maxTokens && keptIndex.length > 0) {
		keptIndex = keptIndex.slice(0, -1);
		trimmed = true;
	}
	while (total() > maxTokens && keptPlaybooks.length > 0) {
		keptPlaybooks = keptPlaybooks.slice(0, -1);
		trimmed = true;
	}
	while (total() > maxTokens && keptPractices.length > 0) {
		keptPractices = keptPractices.slice(0, -1);
		trimmed = true;
	}

	return {
		queryAreas,
		practices: keptPractices,
		playbooks: keptPlaybooks,
		indexSlices: keptIndex,
		semanticSlices: keptSemantic,
		estimatedTokens: total(),
		estimatedTokensBeforeCap,
		trimmed,
	};
}

/** Area union of a set of touched paths — re-exported convenience for callers. */
export function areasForPaths(paths: readonly string[]): AreaTag[] {
	return pathsToAreas(paths);
}
