/**
 * Superset Memory — shared domain types (PURE LOGIC, no Node-only deps).
 *
 * These types are the contract between the host-service `memory` tRPC router
 * (which persists them to SQLite + the on-disk vault) and any consumer
 * (renderer, MCP server, future cloud tier). They intentionally avoid Node
 * builtins so the same definitions can be imported in a browser context.
 *
 * Milestone provenance: B1 establishes the data model; B2 fills in capture,
 * B3 the project index, B4 retrieval, B5 consolidation/versioning.
 */

/**
 * An area tag is a coarse, multi-label category derived from the monorepo
 * layout (see `pathToAreas`). A single change usually maps to several areas.
 * Kept as a string union so it is data-driven and easily extensible — adding a
 * new area is a one-line change in the path→area table plus this union.
 */
export type AreaTag =
	| "frontend"
	| "backend"
	| "schema"
	| "design-system"
	| "desktop"
	| "mobile"
	| "marketing"
	| "admin"
	| "docs"
	| "auth"
	| "trpc"
	| "mcp"
	| "shared"
	| "scripts"
	| "tooling"
	| "memory"
	| "tests"
	| "config"
	| "other";

/**
 * Lifecycle of a Playbook (see Assumption A3). A capture lands `provisional`;
 * a merged PR confirms it; a closed-unmerged PR or dropped branch demotes it;
 * `archived` is a soft tombstone kept for provenance/telemetry.
 */
export type PlaybookStatus =
	| "provisional"
	| "confirmed"
	| "demoted"
	| "archived";

/** Scope at which a Coding Practice doc applies. */
export type PracticeScope = "project" | "global";

/**
 * The distilled record of one successful task — *episodic* memory. The shape of
 * the diff is captured, NOT the full diff (privacy + size). Distillation of a
 * session into this shape is B2's job; B1 persists a pre-distilled input.
 */
export interface Playbook {
	id: string;
	/** Host project this Playbook belongs to (`projects.id`); null = unscoped. */
	projectId: string | null;
	/** One-line statement of what the task accomplished. */
	intent: string;
	/** Repo-relative paths the task touched. */
	touchedPaths: string[];
	/** Multi-label areas derived from `touchedPaths` (+ optional task labels). */
	areaTags: AreaTag[];
	/** Commands that proved to work (build/test/lint/run). */
	commands: string[];
	/** The non-obvious pitfall the task avoided, if any. */
	gotcha: string | null;
	/** A terse description of the change *shape* (files added/edited, pattern). */
	diffShape: string | null;
	/** How success was proven (e.g. "host-service suite 757/0; lint 0"). */
	validation: string | null;
	status: PlaybookStatus;
	/** 0..1 quality estimate; bumped on confirm, lowered on demote. */
	confidence: number;
	/** Where this came from — e.g. a PR number/url, a task id. */
	provenance: PlaybookProvenance;
	createdAt: number;
	updatedAt: number;
}

/** Provenance trail for a Playbook (Assumption A3: PR is the quality signal). */
export interface PlaybookProvenance {
	/** GitHub-style PR number when captured at PR time. */
	prNumber: number | null;
	/** PR / source URL, if known. */
	url: string | null;
	/** Originating task id, if known. */
	taskId: string | null;
}

/**
 * One entry in the per-project map of the codebase — *semantic* memory
 * (lightweight, structural). B3 owns building/refreshing these; B1 defines the
 * row so the table + router surface exist.
 */
export interface ProjectIndexEntry {
	id: string;
	projectId: string;
	/** Repo-relative path of the indexed file/dir. */
	path: string;
	/** "file" | "dir" | "symbol" — kept open as a string for B3 extension. */
	kind: string;
	/** Areas this entry maps to (from `pathToAreas`). */
	areaTags: AreaTag[];
	/** Exported symbol names / a one-line summary ("where X lives"). */
	summary: string | null;
	/** Fingerprint id linking to the staleness record. */
	fingerprintId: string | null;
	updatedAt: number;
}

/**
 * A durable, versioned Coding Practice document for a scope. The *current*
 * content is the latest `PracticeVersion`; older versions enable revert (A10).
 */
export interface PracticeDoc {
	scope: PracticeScope;
	/** Project id for `scope: "project"`; null for `scope: "global"`. */
	projectId: string | null;
	/** The latest version, or null when no practice has been consolidated yet. */
	latest: PracticeVersion | null;
}

/** One immutable, revertible revision of a Practice doc. */
export interface PracticeVersion {
	id: string;
	scope: PracticeScope;
	projectId: string | null;
	/** Monotonic version number within (scope, projectId). */
	version: number;
	/** Full Markdown content of the practice at this version. */
	content: string;
	/** Provenance summary — e.g. "consolidated from PRs #12, #18". */
	provenance: string | null;
	createdAt: number;
}

/**
 * Content-hash + commit SHA fingerprint used to detect when an indexed entry or
 * a Playbook's referenced state has gone stale (B3). Best-effort; a mismatch
 * means "decay/refresh", never a hard failure.
 */
export interface MemoryFingerprint {
	id: string;
	projectId: string;
	/** What this fingerprint covers (a path, a Playbook id, etc.). */
	subject: string;
	/** Stable content hash of the subject at capture/index time. */
	contentHash: string;
	/** Git commit SHA the fingerprint was taken at, if known. */
	commitSha: string | null;
	createdAt: number;
}

/** A single token-savings / exploration telemetry sample (B4). */
export interface MemoryTelemetrySample {
	id: string;
	projectId: string | null;
	/** Originating task id, if known. */
	taskId: string | null;
	/** "tokens" | "exploration_steps" | other named metric. */
	metric: string;
	/** Measurement before memory was injected. */
	baselineValue: number | null;
	/** Measurement with memory injected. */
	observedValue: number;
	createdAt: number;
}
