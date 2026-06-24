import type { CodeViewScrollTarget } from "@pierre/diffs";

export interface ResolveScrollTargetArgs {
	/** The anchored file path (a guide anchor's `file`). */
	focusFile: string | undefined;
	/** 1-based line to center on; absent ⇒ scroll to the file header. */
	focusLine: number | undefined;
	/** filename (and previousFilename) → CodeView item id, for renderable files. */
	itemIdByFile: ReadonlyMap<string, string>;
	/** The set of item ids actually present in the rendered CodeView. */
	renderableItemIds: ReadonlySet<string>;
}

/**
 * Resolve a guide anchor's `{ focusFile, focusLine }` to a `@pierre/diffs`
 * `CodeViewScrollTarget` (Wave 5, M5) — PURE LOGIC, extracted from `PrDiffView`'s
 * scroll effect so the file→item-id resolution (incl. the rename `previousName`
 * fallback) and the line-vs-file target choice are unit-testable without
 * mounting a CodeView.
 *
 * Returns null when there's nothing to scroll to: no `focusFile`, the file has
 * no renderable patch (binary/too-large → not in `itemIdByFile`), or the file
 * isn't part of this PR's rendered items. A line target centers on `focusLine`;
 * absent a line, the target is the file item (scrolled to its top). The same
 * `CodeViewScrollTarget` shapes the local-diff `useDiffCodeViewScroll` uses.
 */
export function resolveScrollTarget({
	focusFile,
	focusLine,
	itemIdByFile,
	renderableItemIds,
}: ResolveScrollTargetArgs): CodeViewScrollTarget | null {
	if (!focusFile) return null;
	const targetItemId = itemIdByFile.get(focusFile);
	if (!targetItemId || !renderableItemIds.has(targetItemId)) return null;

	if (focusLine != null) {
		return {
			type: "line",
			id: targetItemId,
			lineNumber: focusLine,
			align: "center",
			behavior: "smooth-auto",
		};
	}
	return {
		type: "item",
		id: targetItemId,
		align: "start",
		behavior: "smooth-auto",
	};
}

/**
 * A dedup key for a resolved scroll request, so the effect fires once per click
 * and re-fires when `focusTick` bumps (the same anchor clicked again). Returns
 * null when nothing resolves (mirrors {@link resolveScrollTarget}).
 */
export function scrollRequestKey({
	focusFile,
	focusLine,
	focusTick,
	itemIdByFile,
	renderableItemIds,
}: ResolveScrollTargetArgs & { focusTick: number | undefined }): string | null {
	if (!focusFile) return null;
	const targetItemId = itemIdByFile.get(focusFile);
	if (!targetItemId || !renderableItemIds.has(targetItemId)) return null;
	return [targetItemId, focusLine ?? "", focusTick ?? ""].join(":");
}
