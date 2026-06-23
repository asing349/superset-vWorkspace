import { pathsToAreas } from "../path-to-area";
import type { AreaTag } from "../types";

/**
 * Capture distillation (PURE LOGIC, no Node, NO model call).
 *
 * B2 turns a finished, just-PR'd session into the `MemoryCaptureInput` shape
 * the B1 `capture` procedure persists. Per the wave-3 Decision Log + the
 * LOCAL-ONLY / EGRESS-FREE constraint, the DEFAULT path is fully deterministic:
 * we assemble the capture fields from already-local sources —
 *
 *   - touched paths + diff shape  ← the workspace git diff (host-side)
 *   - intent                      ← the PR title (+ a body's first line)
 *   - validation                  ← whatever the caller knows locally
 *
 * This module owns the *pure shaping* of those raw inputs (no fs/git/model). The
 * git read itself lives host-side (it needs a subprocess) and feeds this helper.
 */

/** Coarse change status of one touched file, aligned with git's name-status. */
export type DiffFileStatus =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| "copied"
	| "changed"
	| "untracked";

/** One changed file, as read from the local git diff (host-side). */
export interface DiffFileChange {
	/** Repo-relative POSIX path of the (new) file. */
	path: string;
	status: DiffFileStatus;
	/** Lines added, when known (0 otherwise). */
	additions?: number;
	/** Lines deleted, when known (0 otherwise). */
	deletions?: number;
}

/** Raw, already-local inputs a finished PR session exposes. */
export interface DistillCaptureInput {
	/** GitHub-style PR title — the primary intent source. */
	prTitle: string;
	/** PR body, if any — only the first non-empty line is used for intent. */
	prBody?: string | null;
	/** Changed files from the local git diff vs the PR base. */
	changedFiles: readonly DiffFileChange[];
	/** Commands proven to work this session, if the host knows them. */
	commands?: readonly string[];
	/** How success was proven (e.g. "lint 0; typecheck clean"), if known. */
	validation?: string | null;
	/** A non-obvious pitfall avoided, if the host can surface one. */
	gotcha?: string | null;
}

/** The distilled, pre-redaction capture fields (B1 redacts on persist). */
export interface DistilledCapture {
	intent: string;
	touchedPaths: string[];
	areaTags: AreaTag[];
	commands: string[];
	gotcha: string | null;
	diffShape: string | null;
	validation: string | null;
}

/** How many touched paths to enumerate explicitly in the diff shape. */
const MAX_SHAPE_PATHS = 12;

function firstNonEmptyLine(text: string | null | undefined): string | null {
	if (!text) return null;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length > 0) return line;
	}
	return null;
}

/**
 * Derive a one-line intent. Prefer the PR title; if it's empty, fall back to the
 * body's first line, then to a path-derived summary. Always deterministic.
 */
export function distillIntent(input: {
	prTitle: string;
	prBody?: string | null;
	changedFiles: readonly DiffFileChange[];
}): string {
	const title = input.prTitle.trim();
	if (title.length > 0) return title;

	const bodyLine = firstNonEmptyLine(input.prBody);
	if (bodyLine) return bodyLine;

	const first = input.changedFiles[0]?.path;
	if (first) {
		const count = input.changedFiles.length;
		return count > 1 ? `Changes across ${count} files (${first}, …)` : first;
	}
	return "Untitled change";
}

function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Build a terse, deterministic description of the change *shape* (NOT the full
 * diff): a per-status tally, total line churn, and the touched paths (capped).
 * Privacy- and size-conscious by construction — only paths + counts, never
 * content. Returns null when there are no changes.
 */
export function distillDiffShape(
	changedFiles: readonly DiffFileChange[],
): string | null {
	if (changedFiles.length === 0) return null;

	const byStatus = new Map<DiffFileStatus, number>();
	let additions = 0;
	let deletions = 0;
	for (const file of changedFiles) {
		byStatus.set(file.status, (byStatus.get(file.status) ?? 0) + 1);
		additions += file.additions ?? 0;
		deletions += file.deletions ?? 0;
	}

	// Stable, human-readable status order.
	const statusOrder: DiffFileStatus[] = [
		"added",
		"modified",
		"deleted",
		"renamed",
		"copied",
		"changed",
		"untracked",
	];
	const tally = statusOrder
		.filter((status) => byStatus.has(status))
		.map((status) => `${byStatus.get(status)} ${status}`)
		.join(", ");

	const fileWord = pluralize(changedFiles.length, "file");
	const churn = `+${additions}/-${deletions}`;

	const paths = changedFiles.map((file) => file.path).sort();
	const shownPaths = paths.slice(0, MAX_SHAPE_PATHS);
	const overflow = paths.length - shownPaths.length;
	const pathList =
		overflow > 0
			? `${shownPaths.join(", ")}, +${overflow} more`
			: shownPaths.join(", ");

	return `${fileWord} (${tally}); ${churn}. Paths: ${pathList}`;
}

/**
 * Distill a finished PR session into the capture fields. DETERMINISTIC and
 * LOCAL — no model, no network. The result is fed to the B1 `capture`
 * procedure, which redacts free text and derives/merges area tags on persist.
 */
export function distillCapture(input: DistillCaptureInput): DistilledCapture {
	const touchedPaths = [
		...new Set(input.changedFiles.map((file) => file.path)),
	].sort();

	return {
		intent: distillIntent({
			prTitle: input.prTitle,
			prBody: input.prBody,
			changedFiles: input.changedFiles,
		}),
		touchedPaths,
		areaTags: pathsToAreas(touchedPaths),
		commands: [...(input.commands ?? [])],
		gotcha: input.gotcha ?? null,
		diffShape: distillDiffShape(input.changedFiles),
		validation: input.validation ?? null,
	};
}
