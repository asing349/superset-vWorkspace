import type { FileStatus } from "../../components/StatusIndicator";

export type DiffRef =
	| { kind: "against-base"; baseBranch: string | null }
	| { kind: "uncommitted" }
	| { kind: "commit"; commitHash: string; fromHash?: string };

export type DiffFileSource =
	| { kind: "against-base"; baseBranch: string | null }
	| { kind: "staged" }
	| { kind: "unstaged" }
	| { kind: "commit"; commitHash: string; fromHash?: string };

/**
 * Wave 5, M2 note — the PR-review window does NOT extend `DiffRef`/
 * `DiffFileSource` with a `pr` case. Those types drive the LOCAL-worktree diff
 * (`useChangeset` → `useSidebarDiffRef` → `useDiffCodeViewItems` → per-file
 * `git.getDiff` fetch of file CONTENTS, then `parseDiffFromFile`), all keyed to
 * the route's single `workspaceId`. An arbitrary repo PR (possibly not checked
 * out) has no `workspaceId`-scoped changeset — it has a `(projectId, prNumber)`
 * and RAW unified-diff `patch` strings from `prReview.getDiff`. So the PR diff
 * is rendered by a dedicated `PrReviewPane/PrDiffView` that reuses the SAME
 * render primitives (`@pierre/diffs` `CodeView` + `useDiffCodeViewTheme`) but
 * builds items via `processFile(patch)` directly (`buildPrDiffItems`) — it does
 * not flow through this local-worktree ref union. Adding a non-functional `pr`
 * member here only broke the exhaustive ref/source switches without buying
 * anything, so it was deliberately left out (see the M2 report / Decision Log).
 */

export interface ChangesetFile {
	path: string;
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	source: DiffFileSource;
}
