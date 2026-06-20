import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedWorkspaceGroupRoot } from "./types.ts";

/**
 * Base dir convention for Superset's per-machine state. Mirrors the rest of
 * host-service (`worktree-paths.ts` uses `join(homedir(), ".superset", ...)`,
 * `anthropic-runtime-env.ts` honors a `SUPERSET_HOME_DIR` override first). We
 * resolve the same way so the combined agent root lives alongside worktrees.
 */
export function getSupersetHomeDir(): string {
	return process.env.SUPERSET_HOME_DIR?.trim() || join(homedir(), ".superset");
}

/** Absolute path of the synthetic parent dir for one group's agent root. */
export function getGroupAgentRootPath(groupId: string): string {
	return join(getSupersetHomeDir(), "group-roots", groupId);
}

/**
 * Sanitize a root label into a single safe path segment for the symlink name.
 * Strips path separators and leading dots so a label can never escape the
 * synthetic parent dir or create a hidden entry. Empty results fall back to
 * "root".
 */
function sanitizeLinkName(label: string): string {
	const cleaned = label
		.replace(/[/\\]/g, "-")
		.replace(/\0/g, "")
		.replace(/^\.+/, "")
		.trim();
	return cleaned.length > 0 ? cleaned : "root";
}

/**
 * Assign a unique child name per root, de-duplicating collisions as
 * `name`, `name-2`, `name-3`, … (first occurrence keeps the bare name).
 */
function assignUniqueLinkNames(
	roots: ResolvedWorkspaceGroupRoot[],
): Map<string, string> {
	const namesByRootId = new Map<string, string>();
	const used = new Set<string>();
	for (const root of roots) {
		const base = sanitizeLinkName(root.label);
		let candidate = base;
		let suffix = 2;
		while (used.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		used.add(candidate);
		namesByRootId.set(root.rootId, candidate);
	}
	return namesByRootId;
}

export interface PrepareAgentRootResult {
	/** Absolute path of the synthetic parent dir holding one symlink per root. */
	agentRootPath: string;
	/** Child link names that now exist, in root order. */
	linkedRootNames: string[];
	/** Roots skipped because their target does not exist on disk. */
	skippedRootIds: string[];
}

/**
 * Idempotently build a synthetic parent directory containing one symbolic link
 * per group root (Q3 default mechanism). Reconciles on every run:
 *   - creates the parent dir if missing,
 *   - adds links for roots that don't have one yet,
 *   - re-points links whose target drifted,
 *   - removes stale entries that no longer correspond to a current root,
 *   - skips roots whose resolved target doesn't exist (`exists: false`) so a
 *     deleted worktree never crashes the prepare.
 *
 * A CLI agent launched with `cwd = agentRootPath` then sees each root as a
 * subdirectory.
 */
export function prepareAgentRoot(input: {
	groupId: string;
	roots: ResolvedWorkspaceGroupRoot[];
}): PrepareAgentRootResult {
	const agentRootPath = getGroupAgentRootPath(input.groupId);
	mkdirSync(agentRootPath, { recursive: true });

	const presentRoots = input.roots.filter(
		(root) => root.exists && root.rootPath !== "",
	);
	const skippedRootIds = input.roots
		.filter((root) => !root.exists || root.rootPath === "")
		.map((root) => root.rootId);

	const namesByRootId = assignUniqueLinkNames(presentRoots);
	const desiredTargetByName = new Map<string, string>();
	const linkedRootNames: string[] = [];
	for (const root of presentRoots) {
		const name = namesByRootId.get(root.rootId);
		if (!name) continue;
		desiredTargetByName.set(name, root.rootPath);
		linkedRootNames.push(name);
	}

	// Remove stale or drifted entries before (re)creating, so a name reused for
	// a different target is replaced rather than left pointing at the old root.
	for (const entryName of readdirSync(agentRootPath)) {
		const entryPath = join(agentRootPath, entryName);
		const desiredTarget = desiredTargetByName.get(entryName);
		const isCurrentLink = lstatSync(entryPath).isSymbolicLink();
		let currentTarget: string | null = null;
		if (isCurrentLink) {
			currentTarget = readlinkSync(entryPath);
		}
		const stale =
			desiredTarget === undefined ||
			!isCurrentLink ||
			currentTarget !== desiredTarget;
		if (stale) {
			rmSync(entryPath, { recursive: true, force: true });
		}
	}

	// Add any links that are now missing (newly desired, or just removed above
	// because they had drifted).
	for (const [name, target] of desiredTargetByName) {
		const linkPath = join(agentRootPath, name);
		if (!existsSync(linkPath) && !lstatSyncSafe(linkPath)) {
			symlinkSync(target, linkPath);
		}
	}

	return { agentRootPath, linkedRootNames, skippedRootIds };
}

/**
 * `existsSync` follows symlinks and reports false for a link with a missing
 * target, which would let us try to re-create an existing (dangling) link and
 * throw EEXIST. `lstatSync` detects the link itself; return whether the path
 * exists as any kind of entry without following it.
 */
function lstatSyncSafe(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Per-group serialization tail (Wave-2 M2). `prepareAgentRoot` reconciles the
 * synthetic dir by reading the current entries and adding/removing symlinks; two
 * concurrent runs for the SAME group can interleave those non-atomic fs ops and
 * race (e.g. one removes a link the other just created). The launcher and
 * `createSession` deliberately double-invoke the preparer, so this is a real
 * collision. We keep one in-flight promise per `groupId` and chain the next call
 * onto its tail, so same-group calls run strictly one after another while
 * different groups stay fully parallel. The reconcile body itself stays
 * synchronous; only the entry point is serialized.
 */
const inFlightByGroupId = new Map<string, Promise<PrepareAgentRootResult>>();

/**
 * Serialized entry point for {@link prepareAgentRoot}. Concurrent calls for the
 * same `groupId` are queued and run one at a time (errors don't poison the
 * queue); calls for different groups run concurrently. Returns the same
 * `PrepareAgentRootResult` (`{ agentRootPath, linkedRootNames, skippedRootIds }`)
 * as the synchronous function.
 */
export function prepareAgentRootSerialized(input: {
	groupId: string;
	roots: ResolvedWorkspaceGroupRoot[];
}): Promise<PrepareAgentRootResult> {
	const previous =
		inFlightByGroupId.get(input.groupId) ?? Promise.resolve(undefined);
	// Run after the previous same-group call settles (success OR failure), so one
	// failed prepare never blocks the queue. `catch(() => {})` only swallows the
	// PREVIOUS call's rejection for chaining; the previous caller still received
	// its own rejection from its own returned promise.
	const next = previous
		.catch(() => undefined)
		.then(() => prepareAgentRoot(input));
	inFlightByGroupId.set(input.groupId, next);
	// Drop the map entry once this is the tail, so groups don't accumulate.
	void next.finally(() => {
		if (inFlightByGroupId.get(input.groupId) === next) {
			inFlightByGroupId.delete(input.groupId);
		}
	});
	return next;
}
