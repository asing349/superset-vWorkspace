import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

type GitStatusData = inferRouterOutputs<AppRouter>["git"]["getStatus"];
type ChangedFile = GitStatusData["againstBase"][number];
export type ChangeStatus = ChangedFile["status"];

/** Short, fixed-width status tag shown in the per-root Changes list. */
export const STATUS_LABEL: Record<ChangeStatus, string> = {
	added: "A",
	untracked: "U",
	modified: "M",
	changed: "M",
	deleted: "D",
	renamed: "R",
	copied: "C",
};

/**
 * "Worst wins" ordering when one path appears in multiple buckets — deletions
 * dominate, then modifications, then additions. Mirrors the severity ranking
 * `useGitStatusMap` uses for folder roll-ups.
 */
const STATUS_SEVERITY: Record<ChangeStatus, number> = {
	deleted: 5,
	modified: 4,
	changed: 4,
	added: 3,
	untracked: 2,
	renamed: 1,
	copied: 0,
};

export interface MergedChangedFile {
	path: string;
	status: ChangeStatus;
}

/**
 * Flatten a git status snapshot into a single deduped, path-sorted list of
 * changed files for the compact per-root Changes section.
 *
 * A path can appear in several buckets (`againstBase`, `staged`, `unstaged`);
 * we keep the highest-severity status so a file staged-as-added but then
 * deleted in the working tree still surfaces its most significant state.
 */
export function mergeChangedFiles(
	status: GitStatusData | undefined,
): MergedChangedFile[] {
	if (!status) return [];

	const byPath = new Map<string, ChangeStatus>();
	const consider = (file: ChangedFile) => {
		const existing = byPath.get(file.path);
		if (
			existing === undefined ||
			STATUS_SEVERITY[file.status] > STATUS_SEVERITY[existing]
		) {
			byPath.set(file.path, file.status);
		}
	};

	for (const file of status.againstBase) consider(file);
	for (const file of status.staged) consider(file);
	for (const file of status.unstaged) consider(file);

	return Array.from(byPath, ([path, fileStatus]) => ({
		path,
		status: fileStatus,
	})).sort((a, b) => a.path.localeCompare(b.path));
}
