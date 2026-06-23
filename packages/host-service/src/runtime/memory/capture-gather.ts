import type { DiffFileChange, DiffFileStatus } from "@superset/memory";
import type { SimpleGit } from "simple-git";
import type { FileStatus } from "../../trpc/router/git/types.ts";
import {
	getChangedFilesForDiff,
	resolveBaseComparison,
} from "../../trpc/router/git/utils/git-helpers.ts";

/**
 * Host-side capture gathering for Superset Memory B2 (LOCAL / EGRESS-FREE).
 *
 * Reads the workspace's git diff vs the PR base — the SAME merge-base 3-dot
 * comparison the Changes view uses — to produce the `DiffFileChange[]` the pure
 * `distillCapture` helper shapes into `touchedPaths` + a `diffShape`. No model,
 * no network: the only external read is the local git subprocess.
 */

/**
 * Map the git router's `FileStatus` onto the memory package's `DiffFileStatus`.
 * They share most labels; the few git-only values collapse to "changed".
 */
function toDiffFileStatus(status: FileStatus): DiffFileStatus {
	switch (status) {
		case "added":
		case "modified":
		case "deleted":
		case "renamed":
		case "copied":
		case "untracked":
			return status;
		default:
			return "changed";
	}
}

/**
 * Collect the changed files for a branch vs its base, as a list the distiller
 * can shape. Uses the merge base so the diff excludes unrelated commits that
 * landed on the base after the branch forked — matching the PR file list.
 *
 * Never throws: a git failure yields an empty list, so capture degrades to a
 * paths-less Playbook rather than failing the user's Save click.
 */
export async function gatherChangedFiles({
	git,
	baseBranch,
}: {
	git: SimpleGit;
	/** Explicit base branch; falls back to the repo's default branch. */
	baseBranch?: string;
}): Promise<DiffFileChange[]> {
	try {
		const base = await resolveBaseComparison(git, baseBranch);
		const baseRef = base?.baseRef ?? null;

		// Prefer the 3-dot merge-base diff vs the resolved base; if no base can
		// be resolved (e.g. brand-new repo), fall back to HEAD vs its parent so
		// at least the latest commit's shape is captured.
		const diffArgs = baseRef ? [`${baseRef}...HEAD`] : ["HEAD~1...HEAD"];
		const changed = await getChangedFilesForDiff(git, diffArgs);

		return changed.map((file) => ({
			path: file.path,
			status: toDiffFileStatus(file.status),
			additions: file.additions,
			deletions: file.deletions,
		}));
	} catch {
		return [];
	}
}
