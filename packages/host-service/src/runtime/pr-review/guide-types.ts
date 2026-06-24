import type { AreaTag } from "@superset/memory";
import type { FileStatus } from "../../trpc/router/git/types.ts";

/**
 * PR-review Guide artifact contract (Wave 5, M3).
 *
 * These types are the SHARED CONTRACT between the host guide generator
 * (`buildGuideSkeleton`, M3 / `prReview.generateGuide`, M4) and the renderer's
 * Guide tab (which derives them via `inferRouterOutputs`, M5 wires the anchors).
 * They are PURE data — no Node-only deps — so they can be imported in a browser
 * context once they ride a tRPC procedure's output.
 *
 * The core shape is intentionally small and stable:
 *   PrReviewGuide → GuideSection[] → GuideItem[]
 * Each GuideItem that points at code carries a `GuideAnchor` so M5 can scroll the
 * sibling Diff tab to the file/hunk and/or open the editor at `file:line`.
 */

// ---------------------------------------------------------------------------
// Diff INPUT contract (diff's M1 FIXED CONTRACT — decoupled from this milestone)
// ---------------------------------------------------------------------------

/**
 * One file in a PR diff, as M1's `prReview.getDiff` produces it. Mirrors the
 * GitHub `pulls/{n}/files` row (and the local `git diff` fallback). `patch` is
 * the unified-diff text the renderer parses; null when GitHub omits it (binary
 * files, files too large). `previousFilename` is set on renames/copies.
 */
export interface PrDiffFile {
	filename: string;
	status: FileStatus;
	/** Unified-diff patch text; null for binary / too-large / no-patch files. */
	patch: string | null;
	additions: number;
	deletions: number;
	/** Prior path on a rename/copy; absent otherwise. */
	previousFilename?: string;
}

/**
 * The whole-PR diff input M3 consumes. This is exactly diff's M1 fixed output
 * contract, restated here so M3 can be built + tested against a FIXTURE without
 * depending on M1's fetch. M1 and M3 share this shape.
 */
export interface PrDiffInput {
	files: PrDiffFile[];
	/** PR description body; null when the PR has none. */
	body: string | null;
	/** The PR's base branch (the merge target). */
	baseBranch: string;
	/** HEAD commit SHA of the PR — the cache + staleness key (M6). */
	headSha: string;
	prNumber: number;
}

// ---------------------------------------------------------------------------
// Guide ARTIFACT contract (this milestone's OUTPUT — window renders it)
// ---------------------------------------------------------------------------

/**
 * A code anchor attached to a guide claim. Clicking the rendered item jumps the
 * sibling Diff tab to `file` (and `line`/`symbol` when present) and/or opens the
 * editor at `file:line` (M5 reuses wave-3 A3 `focusLine`/`revealPosition`).
 * Every guide claim that points at code MUST carry one.
 */
export interface GuideAnchor {
	/** Repo-relative POSIX path of the target file. */
	file: string;
	/** 1-based line in the file's NEW side, when a precise line is known. */
	line?: number;
	/** Exported symbol name ("where X lives"), when resolved from the index. */
	symbol?: string;
}

/** Severity of a risk-flag item, for the renderer to colour/prioritize. */
export type GuideRiskSeverity = "info" | "warning" | "danger";

/**
 * One claim within a guide section. `text` is the human-readable line; `anchor`
 * is present whenever the claim points at a specific file/line/symbol. Optional
 * `severity` is set on risk-flag items; optional `href` carries an external
 * target (a PR / playbook URL) the renderer may open instead of a code anchor.
 */
export interface GuideItem {
	text: string;
	anchor?: GuideAnchor;
	/** Set on risk-flag items; absent elsewhere. */
	severity?: GuideRiskSeverity;
	/** External link target (e.g. a prior PR URL); absent for code anchors. */
	href?: string;
}

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

/** One section of the guide: a stable id, a human title, and its claims. */
export interface GuideSection {
	id: GuideSectionId;
	title: string;
	items: GuideItem[];
}

/**
 * The computed Guide artifact. `sections` is ordered for top-to-bottom reading;
 * `grounded` is false when the guide degraded to diff-only (no locally-indexed
 * project / empty memory), so the renderer can badge "deterministic only".
 */
export interface PrReviewGuide {
	sections: GuideSection[];
	/** The PR this guide was built for. */
	prNumber: number;
	/** The HEAD SHA the guide was built against (cache/staleness key). */
	headSha: string;
	/** Areas the touched paths resolved to (drives grounding queries). */
	areaTags: AreaTag[];
	/**
	 * True when memory grounding contributed (indexed project + non-empty
	 * memory); false when the guide is the deterministic diff-only baseline.
	 */
	grounded: boolean;
}
