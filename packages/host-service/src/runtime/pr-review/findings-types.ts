/**
 * PR-review Findings artifact contract (Wave 6, M1).
 *
 * A `Finding` is one structured review issue. It EXTENDS the wave-5 `GuideItem`
 * shape (which already carries `text`, `anchor`, `severity`) with the three
 * pieces wave-6 needs: a `category`, a free-text `rationale`, and a per-finding
 * `state` (so the M3 commenting flow can flip a single finding to `posted`
 * without a schema change). The anchor gains a `line`/`symbol` so a finding can
 * point at a precise NEW-side line in the Diff tab.
 *
 * These types are PURE data — no Node-only deps — so they ride the
 * `prReview.reviewPr` / `getCachedFindings` tRPC procedures and the renderer
 * derives them via `inferRouterOutputs` (the same browser-safe seam the wave-5
 * guide types use).
 */

/** Severity of a finding, for the renderer to colour/prioritize. */
export type FindingSeverity = "info" | "warning" | "danger";

/**
 * What KIND of issue a finding is. A finite enum the prompt constrains the model
 * to and the deterministic baseline classifier maps risk flags onto.
 */
export type FindingCategory =
	| "correctness"
	| "business-logic"
	| "convention"
	| "security"
	| "perf";

/**
 * Per-finding lifecycle. `open` is the default a fresh review writes; M3 flips a
 * finding to `posted` once its comment lands on GitHub; `dismissed` lets a user
 * hide a finding without re-reviewing.
 */
export type FindingState = "open" | "posted" | "dismissed";

/**
 * A code anchor attached to a finding. `file` is ALWAYS one of the PR diff's
 * changed files (the anti-hallucination guard rejects anything else). `line` is
 * a 1-based NEW-side line that the diff's `@@` hunks actually cover (computed,
 * never trusted from the model verbatim); `symbol` is an optional name.
 */
export interface FindingAnchor {
	/** Repo-relative POSIX path; always a file present in the PR diff. */
	file: string;
	/** 1-based NEW-side line, present only when the diff's hunks cover it. */
	line?: number;
	/** Symbol the finding is about, when the model named one. */
	symbol?: string;
}

/**
 * One structured review finding. `text` is a short headline (the GuideItem seam);
 * `rationale` is the explanation; `source` records whether it came from the
 * always-available deterministic baseline or a best-effort local-AI pass.
 */
export interface Finding {
	/** Stable id for this finding within a report (UUID). */
	id: string;
	severity: FindingSeverity;
	category: FindingCategory;
	anchor: FindingAnchor;
	/** Short, human-readable headline (e.g. `file:line`). */
	text: string;
	/** The reviewer-facing explanation. Redacted when model-authored. */
	rationale: string;
	state: FindingState;
	/** Provenance: the deterministic baseline vs the local-AI pass. */
	source: "baseline" | "local-ai";
}

/**
 * The computed Findings artifact for one PR at one head SHA — the output of the
 * `prReview.reviewPr` mutation and what the host findings cache persists.
 */
export interface FindingsReport {
	/** Ordered findings (deterministic baseline first, then local-AI). */
	findings: Finding[];
	/** The PR these findings were produced for. */
	prNumber: number;
	/** The HEAD SHA the findings were built against (cache/staleness key). */
	headSha: string;
	/** True when a local AI session contributed at least one finding. */
	enriched: boolean;
	/**
	 * True when no local agent was connected, so the report is the deterministic
	 * baseline only (the renderer can badge "deterministic only").
	 */
	baselineOnly: boolean;
}
