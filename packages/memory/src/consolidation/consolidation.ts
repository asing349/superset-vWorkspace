import type { AreaTag, Playbook, PracticeScope } from "../types";

/**
 * Coding-Practice consolidation (PURE LOGIC, B5). Given confirmed Playbooks,
 * deterministically distill a small, deduped, PRUNED set of practice rules and
 * render them as Markdown — with NO model call and NO network (Assumption A10:
 * prune/merge, never append-only). The host supplies the rows + writes the file;
 * this module owns the heuristic + the managed-block + the diff, all as pure
 * string/array work so it is portable (renderer-safe) and unit-testable.
 *
 * Optional model enrichment may later ride the user's running agent session, but
 * THIS default must work with zero model calls.
 */

// ---------------------------------------------------------------------------
// Proposal model
// ---------------------------------------------------------------------------

/** One distilled practice rule, with the provenance that justifies it. */
export interface PracticeRule {
	/** The area this rule belongs to (groups the doc). */
	area: AreaTag;
	/** The rule text (imperative, one line). */
	text: string;
	/** How many confirmed Playbooks support this rule. */
	support: number;
	/** Distinct projects the supporting Playbooks came from (global promotion). */
	projectCount: number;
	/** PR numbers / sources that contributed (provenance trail). */
	prNumbers: number[];
}

/** A structured, reviewable consolidation proposal (before rendering). */
export interface PracticeProposal {
	scope: PracticeScope;
	rules: PracticeRule[];
	/** A one-line provenance summary (e.g. "consolidated from PRs #12, #18"). */
	provenance: string;
	/** Count of confirmed Playbooks that fed the proposal. */
	sourceCount: number;
}

export interface ConsolidateOptions {
	scope: PracticeScope;
	playbooks: readonly Playbook[];
	/**
	 * Prune any rule whose mean supporting confidence is below this (0..100).
	 * Default 50 — drops weak/uncertain captures so the always-loaded layer
	 * stays small (A10).
	 */
	minConfidence?: number;
	/**
	 * GLOBAL only: a pattern must recur across at least this many DISTINCT
	 * projects to be promoted (or be clearly-general). Default 2.
	 */
	minProjectsForGlobal?: number;
	/** Max rules per area in the final doc (keeps it small). Default 6. */
	maxRulesPerArea?: number;
}

// ---------------------------------------------------------------------------
// Heuristic
// ---------------------------------------------------------------------------

const DEFAULT_MIN_CONFIDENCE = 50;
const DEFAULT_MIN_PROJECTS_GLOBAL = 2;
const DEFAULT_MAX_RULES_PER_AREA = 6;

/** Stable display order for area sections in the rendered doc. */
const AREA_ORDER: readonly AreaTag[] = [
	"frontend",
	"backend",
	"schema",
	"design-system",
	"desktop",
	"mobile",
	"marketing",
	"admin",
	"docs",
	"auth",
	"trpc",
	"mcp",
	"shared",
	"scripts",
	"tooling",
	"memory",
	"tests",
	"config",
	"other",
];

/** Normalize an intent for dedupe/merge: lowercase, collapse whitespace. */
function normalizeIntent(intent: string): string {
	return intent.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Turn a captured intent into an imperative rule line ("Add X" -> "Add X"). */
function ruleTextFromIntent(intent: string): string {
	const trimmed = intent.trim().replace(/\s+/g, " ");
	if (trimmed.length === 0) return trimmed;
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

interface IntentCluster {
	key: string;
	text: string;
	playbooks: Playbook[];
}

/**
 * Cluster playbooks by normalized intent (dedupe identical work; the count
 * becomes the rule's support). Merging "similar" intents is deliberately
 * conservative — exact normalized match only — so the deterministic default
 * never fabricates a rule by over-merging distinct tasks.
 */
function clusterByIntent(playbooks: readonly Playbook[]): IntentCluster[] {
	const clusters = new Map<string, IntentCluster>();
	for (const playbook of playbooks) {
		const key = normalizeIntent(playbook.intent);
		if (key.length === 0) continue;
		const existing = clusters.get(key);
		if (existing) {
			existing.playbooks.push(playbook);
		} else {
			clusters.set(key, {
				key,
				text: ruleTextFromIntent(playbook.intent),
				playbooks: [playbook],
			});
		}
	}
	return [...clusters.values()];
}

/** Mean confidence across a cluster's playbooks (0 when empty). */
function meanConfidence(playbooks: readonly Playbook[]): number {
	if (playbooks.length === 0) return 0;
	const sum = playbooks.reduce((acc, p) => acc + p.confidence, 0);
	return sum / playbooks.length;
}

/** Distinct, non-null project ids across a cluster. */
function distinctProjects(playbooks: readonly Playbook[]): Set<string> {
	const set = new Set<string>();
	for (const p of playbooks) {
		if (p.projectId !== null) set.add(p.projectId);
	}
	return set;
}

/** Sorted, de-duped PR numbers across a cluster (provenance). */
function prNumbersOf(playbooks: readonly Playbook[]): number[] {
	const set = new Set<number>();
	for (const p of playbooks) {
		if (p.provenance.prNumber !== null) set.add(p.provenance.prNumber);
	}
	return [...set].sort((a, b) => a - b);
}

/** The primary (first) area of a playbook, used to bucket its rule. */
function primaryArea(playbook: Playbook): AreaTag {
	return playbook.areaTags[0] ?? "other";
}

/**
 * Build a deterministic, pruned/merged consolidation proposal from confirmed
 * Playbooks. Only `confirmed` rows are ever consolidated (the free merge
 * signal); for GLOBAL scope a cluster must recur across ≥ `minProjectsForGlobal`
 * distinct projects to be promoted.
 */
export function consolidatePlaybooks(
	options: ConsolidateOptions,
): PracticeProposal {
	const {
		scope,
		playbooks,
		minConfidence = DEFAULT_MIN_CONFIDENCE,
		minProjectsForGlobal = DEFAULT_MIN_PROJECTS_GLOBAL,
		maxRulesPerArea = DEFAULT_MAX_RULES_PER_AREA,
	} = options;

	// Only confirmed playbooks feed consolidation (provisional/demoted/archived
	// are excluded — quality gate).
	const confirmed = playbooks.filter((p) => p.status === "confirmed");
	const clusters = clusterByIntent(confirmed);

	const rules: PracticeRule[] = [];
	for (const cluster of clusters) {
		// PRUNE: drop low-confidence clusters so weak captures never harden into
		// always-loaded rules (A10).
		if (meanConfidence(cluster.playbooks) < minConfidence) continue;

		const projects = distinctProjects(cluster.playbooks);

		// GLOBAL: only promote patterns that recur across repos.
		if (scope === "global" && projects.size < minProjectsForGlobal) continue;

		const area = primaryArea(cluster.playbooks[0] as Playbook);
		rules.push({
			area,
			text: cluster.text,
			support: cluster.playbooks.length,
			projectCount: projects.size,
			prNumbers: prNumbersOf(cluster.playbooks),
		});
	}

	// Cap per area (keep the strongest by support, then alphabetical for
	// determinism).
	const byArea = new Map<AreaTag, PracticeRule[]>();
	for (const rule of rules) {
		const list = byArea.get(rule.area) ?? [];
		list.push(rule);
		byArea.set(rule.area, list);
	}
	const capped: PracticeRule[] = [];
	for (const [area, list] of byArea) {
		list.sort((a, b) => b.support - a.support || a.text.localeCompare(b.text));
		for (const rule of list.slice(0, maxRulesPerArea)) {
			capped.push({ ...rule, area });
		}
	}

	const allPrNumbers = prNumbersOf(confirmed);
	const provenance =
		allPrNumbers.length > 0
			? `Consolidated from ${confirmed.length} confirmed playbook${
					confirmed.length === 1 ? "" : "s"
				} (PRs ${allPrNumbers.map((n) => `#${n}`).join(", ")})`
			: `Consolidated from ${confirmed.length} confirmed playbook${
					confirmed.length === 1 ? "" : "s"
				}`;

	return { scope, rules: capped, provenance, sourceCount: confirmed.length };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Areas in stable display order, then any unknown areas alphabetically. */
function orderedAreas(areas: Iterable<AreaTag>): AreaTag[] {
	const present = new Set(areas);
	const ordered = AREA_ORDER.filter((a) => present.has(a));
	const extras = [...present]
		.filter((a) => !AREA_ORDER.includes(a))
		.sort((a, b) => a.localeCompare(b));
	return [...ordered, ...extras];
}

const AREA_HEADINGS: Partial<Record<AreaTag, string>> = {
	frontend: "Frontend",
	backend: "Backend",
	schema: "Schema",
	"design-system": "Design system",
	desktop: "Desktop",
	mobile: "Mobile",
	marketing: "Marketing",
	admin: "Admin",
	docs: "Docs",
	auth: "Auth",
	trpc: "tRPC",
	mcp: "MCP",
	shared: "Shared",
	scripts: "Scripts",
	tooling: "Tooling",
	memory: "Memory",
	tests: "Tests",
	config: "Config",
	other: "General",
};

function areaHeading(area: AreaTag): string {
	return AREA_HEADINGS[area] ?? area;
}

/**
 * Render a proposal to Markdown — the BODY that goes inside the managed block
 * (no block markers; {@link applyManagedBlock} adds those). Stable + idempotent:
 * the same proposal renders byte-identical output.
 */
export function renderPracticeMarkdown(proposal: PracticeProposal): string {
	const scopeLabel = proposal.scope === "global" ? "global" : "project";
	const lines: string[] = [
		`## Coding practice (Superset Memory — ${scopeLabel})`,
		"",
		`_${proposal.provenance}._`,
		"",
	];

	if (proposal.rules.length === 0) {
		lines.push(
			"_No confirmed playbooks yet — nothing to consolidate. Merge a PR you saved to memory to seed this._",
		);
		return `${lines.join("\n")}\n`;
	}

	const byArea = new Map<AreaTag, PracticeRule[]>();
	for (const rule of proposal.rules) {
		const list = byArea.get(rule.area) ?? [];
		list.push(rule);
		byArea.set(rule.area, list);
	}

	for (const area of orderedAreas(byArea.keys())) {
		lines.push(`### ${areaHeading(area)}`, "");
		const list = byArea.get(area) ?? [];
		for (const rule of list) {
			const prov =
				rule.prNumbers.length > 0
					? ` (${rule.prNumbers.map((n) => `#${n}`).join(", ")})`
					: "";
			lines.push(`- ${rule.text}${prov}`);
		}
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Managed block (idempotent, non-clobbering)
// ---------------------------------------------------------------------------

export const MANAGED_BLOCK_START = "<!-- superset-memory:start -->";
export const MANAGED_BLOCK_END = "<!-- superset-memory:end -->";

/**
 * Extract the content INSIDE the managed block (between the markers), or null
 * when no block exists. Trims the surrounding newlines the markers add.
 */
export function extractManagedBlock(text: string): string | null {
	const startIdx = text.indexOf(MANAGED_BLOCK_START);
	const endIdx = text.indexOf(MANAGED_BLOCK_END);
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
	const inner = text.slice(startIdx + MANAGED_BLOCK_START.length, endIdx);
	return inner.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Insert/replace the managed block in `existing`, returning the full file text.
 * NEVER clobbers hand-written content: if a block already exists, only its
 * inner content is swapped; otherwise the block is appended (separated by a
 * blank line) and the rest of the file is preserved verbatim. Idempotent —
 * applying the same content twice yields the same file.
 */
export function applyManagedBlock(args: {
	existing: string;
	content: string;
}): string {
	const { existing, content } = args;
	const block = `${MANAGED_BLOCK_START}\n${content.trimEnd()}\n${MANAGED_BLOCK_END}`;

	const startIdx = existing.indexOf(MANAGED_BLOCK_START);
	const endIdx = existing.indexOf(MANAGED_BLOCK_END);
	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + MANAGED_BLOCK_END.length);
		return `${before}${block}${after}`;
	}

	if (existing.trim().length === 0) return `${block}\n`;
	return `${existing.replace(/\n+$/, "")}\n\n${block}\n`;
}

/**
 * Remove the managed block entirely (used when reverting to a state that had no
 * block). Collapses the extra blank lines the block left behind. If no block
 * exists, returns the input unchanged.
 */
export function stripManagedBlock(text: string): string {
	const startIdx = text.indexOf(MANAGED_BLOCK_START);
	const endIdx = text.indexOf(MANAGED_BLOCK_END);
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return text;
	const before = text.slice(0, startIdx).replace(/\n+$/, "");
	const after = text
		.slice(endIdx + MANAGED_BLOCK_END.length)
		.replace(/^\n+/, "");
	if (before.length === 0) return after.length === 0 ? "" : `${after}\n`;
	if (after.length === 0) return `${before}\n`;
	return `${before}\n\n${after}\n`;
}
