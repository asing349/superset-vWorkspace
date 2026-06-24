import { type CodeViewItem, processFile } from "@pierre/diffs";

/**
 * One file of a PR diff, as the host `prReview.getDiff` returns it (diff's M1
 * FIXED CONTRACT). Restated here as the narrow shape this builder needs so the
 * pure transform is testable without `inferRouterOutputs`. Structurally a subset
 * of `PrDiffResult["files"][number]`.
 */
export interface PrDiffFileInput {
	filename: string;
	status: string;
	/** RAW unified-diff patch text; null for binary / too-large / no-patch files. */
	patch: string | null;
	additions: number;
	deletions: number;
	previousFilename?: string;
}

/** A built diff item plus whether its patch was renderable (non-binary). */
export interface PrDiffItemResult {
	/** CodeView item; null when the file has no renderable patch (binary/too-large). */
	item: CodeViewItem | null;
	file: PrDiffFileInput;
	/** Stable id used as the CodeView item id AND the anchor key (M5). */
	itemId: string;
}

/** Stable per-file id, keyed by PR + filename so it survives re-renders. */
export function prDiffItemId(prNumber: number, filename: string): string {
	return `pr-diff:${prNumber}:${filename}`;
}

/**
 * Cheap, deterministic FNV-1a string hash → a numeric `version` so CodeView
 * re-renders an item only when its inputs change. Mirrors the local diff
 * renderer's `hashString`.
 */
function hashString(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/**
 * GitHub's `pulls/{n}/files` `patch` (and the host's local `git diff` fallback
 * for a single path) is HUNKS-ONLY — it starts at the first `@@` with no
 * `diff --git` / `---` / `+++` header. Fed bare, `@pierre/diffs` `processFile`
 * parses ZERO hunks (it can't identify the file), so we MUST synthesize a
 * minimal `diff --git` header around the hunks. `isGitDiff: true` then yields a
 * clean `name` (no `a/`/`b/` prefix) and the real hunks. The `---`/`+++` lines
 * use `/dev/null` on the add/delete side so added/deleted files render as such.
 */
function synthesizeGitDiff(file: PrDiffFileInput, patch: string): string {
	const newPath = file.filename;
	const oldPath = file.previousFilename ?? file.filename;
	const isAdded = file.status === "added";
	const isDeleted = file.status === "removed" || file.status === "deleted";
	const oldSide = isAdded ? "/dev/null" : `a/${oldPath}`;
	const newSide = isDeleted ? "/dev/null" : `b/${newPath}`;
	const header = [
		`diff --git a/${oldPath} b/${newPath}`,
		`--- ${oldSide}`,
		`+++ ${newSide}`,
	].join("\n");
	return `${header}\n${patch}`;
}

/**
 * Build `@pierre/diffs` CodeView diff items from a PR's raw unified-diff patches
 * (Wave 5, M2). This is the renderer side of diff's M1 contract: the HOST
 * returns RAW patch strings (it has no `@pierre/diffs` dep), and the WINDOW runs
 * the parser. We use `processFile` (NOT `parseDiffFromFile`): `parseDiffFromFile`
 * takes two file-CONTENTS objects and synthesizes a patch (what the local-diff
 * renderer does, because it fetches file contents via `git.getDiff`), whereas a
 * PR gives us the unified-diff `patch` text DIRECTLY — once wrapped in a
 * synthesized `diff --git` header, `processFile` parses it into the exact
 * `FileDiffMetadata` a `type:"diff"` CodeView item needs.
 *
 * Files GitHub omits a patch for (binary, too-large) yield a null item the view
 * renders as a "no preview" row.
 */
export function buildPrDiffItems(
	prNumber: number,
	files: readonly PrDiffFileInput[],
): PrDiffItemResult[] {
	return files.map((file) => {
		const itemId = prDiffItemId(prNumber, file.filename);
		if (file.patch === null) {
			return { item: null, file, itemId };
		}

		const fileDiff = processFile(synthesizeGitDiff(file, file.patch), {
			isGitDiff: true,
		});

		if (!fileDiff) {
			return { item: null, file, itemId };
		}

		const item: CodeViewItem = {
			id: itemId,
			type: "diff",
			fileDiff,
			version: hashString(
				[
					file.filename,
					file.previousFilename ?? "",
					file.status,
					file.additions,
					file.deletions,
					file.patch,
				].join("\0"),
			),
		};

		return { item, file, itemId };
	});
}
