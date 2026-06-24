/**
 * Guide artifact contract — the RENDERER's view of the Guide tab's data
 * (Wave 5, M2/M5). This MIRRORS the host's `prReview` guide contract
 * (`packages/host-service/src/runtime/pr-review/guide-types.ts`) exactly:
 * `PrReviewGuide → GuideSection[] → GuideItem[]`, each code-anchored claim
 * carrying a `GuideAnchor`.
 *
 * Why a renderer-local copy rather than `inferRouterOutputs<AppRouter>`:
 * `prReview.generateGuide` is owned by the "guide" teammate (M4) and has NOT
 * landed on the host router yet, so `inferRouterOutputs<AppRouter>["prReview"]
 * ["generateGuide"]` does not resolve today. The renderer can NOT import the
 * host's `guide-types.ts` directly either — it imports `@superset/memory`
 * (`AreaTag`) and `node:`-adjacent host modules, which the browser must not
 * pull in. So M2 defines the SAME pure-data shape here (no Node deps, no host
 * import) and renders against it. When M4 lands `generateGuide`, this shape is
 * structurally identical to its output, so swapping `useGenerateGuide` to the
 * real mutation is a drop-in (M4/M5) with no rendering changes.
 *
 * The shapes below are kept byte-for-byte field-compatible with the host
 * contract. Do not diverge without telling the orchestrator.
 */

/** Stable identifiers for the guide's sections (M5 keys anchor wiring off these). */
export type GuideSectionId =
	| "at-a-glance"
	| "what-changed"
	| "read-first"
	| "risk-flags"
	| "project-conventions"
	| "prior-playbooks"
	| "where-x-lives"
	| "checks-and-threads";

/** Severity of a risk-flag item, for the renderer to colour/prioritize. */
export type GuideRiskSeverity = "info" | "warning" | "danger";

/**
 * A code anchor attached to a guide claim. Clicking the rendered item (M5) jumps
 * the sibling Diff tab to `file` (and `line`/`symbol` when present) and/or opens
 * the editor at `file:line`. Every guide claim that points at code carries one.
 */
export interface GuideAnchor {
	/** Repo-relative POSIX path of the target file. */
	file: string;
	/** 1-based line in the file's NEW side, when a precise line is known. */
	line?: number;
	/** Exported symbol name ("where X lives"), when resolved from the index. */
	symbol?: string;
}

/**
 * One claim within a guide section. `text` is the human-readable line; `anchor`
 * is present whenever the claim points at a specific file/line/symbol. Optional
 * `severity` is set on risk-flag items; optional `href` carries an external
 * target (a PR / playbook URL) the renderer may open instead of a code anchor.
 */
export interface GuideItem {
	text: string;
	anchor?: GuideAnchor;
	severity?: GuideRiskSeverity;
	href?: string;
}

/** One section of the guide: a stable id, a human title, and its claims. */
export interface GuideSection {
	id: GuideSectionId;
	title: string;
	items: GuideItem[];
}

/**
 * The computed Guide artifact the Guide tab renders. `grounded` is false when
 * the guide degraded to the deterministic diff-only baseline (no indexed
 * project / empty memory), so the renderer can badge "deterministic only".
 */
export interface PrReviewGuide {
	sections: GuideSection[];
	prNumber: number;
	headSha: string;
	grounded: boolean;
}
