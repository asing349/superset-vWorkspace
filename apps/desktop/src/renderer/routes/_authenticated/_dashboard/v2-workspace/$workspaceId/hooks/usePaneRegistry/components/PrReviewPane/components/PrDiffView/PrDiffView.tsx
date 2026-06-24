import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { workspaceTrpc } from "@superset/workspace-client";
import { useEffect, useMemo, useRef } from "react";
import type { DiffAnnotationMetadata } from "../../../DiffPane/hooks/useDiffAnnotations";
import { useDiffCodeViewTheme } from "../../../DiffPane/hooks/useDiffCodeViewTheme";
import { buildPrDiffItems } from "../../utils/buildPrDiffItems";
import {
	resolveScrollTarget,
	scrollRequestKey,
} from "../../utils/resolveScrollTarget";

interface PrDiffViewProps {
	/** v2 project the PR belongs to (`workspace.projectId`). */
	projectId: string;
	prNumber: number;
	/**
	 * Anchor scroll target (M5). When a Guide claim is clicked the pane switches
	 * to this tab and passes the anchored file (+ line). `focusTick` bumps on
	 * every click so the scroll effect re-fires even when the same anchor is
	 * clicked twice. All unset ⇒ the diff opens at the top (no scroll).
	 */
	focusFile?: string;
	focusLine?: number;
	focusTick?: number;
}

/**
 * The Diff tab of the PR-review window (Wave 5, M2; M5 adds anchor scroll).
 * Renders an ARBITRARY repo PR's `base..head` diff — a PR that may NOT be
 * checked out locally.
 *
 * Reuse, not reinvention: this renders with the SAME primitives the local-diff
 * `DiffPane` uses — `@pierre/diffs` `CodeView` + `useDiffCodeViewTheme` (shared
 * theme/options/CSS). The ONE thing that differs is item construction: the
 * local `DiffPane` fetches per-file CONTENTS via `git.getDiff` and synthesizes a
 * patch with `parseDiffFromFile`, whereas a PR gives us the unified-diff `patch`
 * text directly from the host `prReview.getDiff`, which `buildPrDiffItems` feeds
 * straight into `@pierre/diffs` `processFile`. The local `DiffPane` is also
 * wired to the route's single workspace (sidebar changes-filter, viewed state,
 * PR review threads) — none of which apply to an arbitrary PR — so reusing the
 * render primitives directly (rather than the whole `DiffPane` component) is the
 * minimal correct path.
 *
 * M5 anchor scroll: a `CodeViewHandle` ref + an effect that resolves
 * `focusFile` → the stable per-file item id and calls `scrollTo` (centered on
 * `focusLine` when known) — the same `CodeViewScrollTarget` mechanism the
 * local-diff `useDiffCodeViewScroll` uses, guarded by a `focusTick`-keyed ref so
 * it fires once per click and re-fires on repeat clicks of the same anchor.
 */
export function PrDiffView({
	projectId,
	prNumber,
	focusFile,
	focusLine,
	focusTick,
}: PrDiffViewProps) {
	const { options, style } = useDiffCodeViewTheme();
	const codeViewRef = useRef<CodeViewHandle<DiffAnnotationMetadata>>(null);

	// `prReview.getDiff` is best-effort and non-throwing host-side (it returns an
	// empty-but-typed result when the PR/repo can't be resolved), so a failure
	// degrades to the empty state rather than erroring. Diffs are immutable per
	// head SHA → cache aggressively.
	const diffQuery = workspaceTrpc.prReview.getDiff.useQuery(
		{ projectId, prNumber },
		{ staleTime: Number.POSITIVE_INFINITY },
	);

	const built = useMemo(
		() => buildPrDiffItems(prNumber, diffQuery.data?.files ?? []),
		[prNumber, diffQuery.data?.files],
	);

	// CodeView is parametrized with the local diff's `DiffAnnotationMetadata` so
	// the shared `useDiffCodeViewTheme` options (typed for that metadata) line up;
	// PR items carry no annotations, so the cast is safe (a no-annotation
	// `CodeViewDiffItem<T>` is assignable for any `T`).
	const items = useMemo<CodeViewItem<DiffAnnotationMetadata>[]>(
		() =>
			built
				.map((b) => b.item)
				.filter((item): item is CodeViewItem => item !== null)
				.map((item) => item as CodeViewItem<DiffAnnotationMetadata>),
		[built],
	);

	// filename → CodeView item id, for resolving an anchor's file to a scroll
	// target. `previousFilename` also maps to the item so a rename anchor resolves
	// whether the guide names the old or new path.
	const itemIdByFile = useMemo(() => {
		const map = new Map<string, string>();
		for (const b of built) {
			if (b.item === null) continue;
			map.set(b.file.filename, b.itemId);
			if (b.file.previousFilename) map.set(b.file.previousFilename, b.itemId);
		}
		return map;
	}, [built]);

	const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

	const lastScrollKeyRef = useRef<string | null>(null);
	useEffect(() => {
		const key = scrollRequestKey({
			focusFile,
			focusLine,
			focusTick,
			itemIdByFile,
			renderableItemIds: itemIds,
		});
		// Nothing resolvable (no anchor / binary / not in this PR), or this exact
		// click already scrolled — `focusTick` bumps per click so a data-driven
		// re-render doesn't re-scroll, but a repeat click of the same anchor does.
		if (!key || lastScrollKeyRef.current === key) return;

		const target = resolveScrollTarget({
			focusFile,
			focusLine,
			itemIdByFile,
			renderableItemIds: itemIds,
		});
		if (!target) return;

		codeViewRef.current?.scrollTo(target);
		lastScrollKeyRef.current = key;
	}, [focusFile, focusLine, focusTick, itemIdByFile, itemIds]);

	// Files GitHub omits a patch for (binary / too-large) render as a list under
	// the diff so they aren't silently dropped.
	const noPreviewFiles = useMemo(
		() => built.filter((b) => b.item === null).map((b) => b.file),
		[built],
	);

	if (diffQuery.isError) {
		return (
			<div className="flex h-full w-full cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
				Unable to load this PR's diff.
			</div>
		);
	}

	const fileCount = diffQuery.data?.files.length ?? 0;

	if (fileCount === 0) {
		return (
			<div className="flex h-full w-full cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
				{diffQuery.isLoading ? "Loading diff…" : "No file changes in this PR."}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			{items.length > 0 ? (
				<CodeView<DiffAnnotationMetadata>
					ref={codeViewRef}
					className="min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain [overflow-anchor:none]"
					style={style}
					items={items}
					options={options}
				/>
			) : (
				<div className="flex flex-1 cursor-text select-text items-center justify-center px-6 text-center text-sm text-muted-foreground">
					{diffQuery.isLoading ? "Loading diff…" : "No previewable changes."}
				</div>
			)}
			{noPreviewFiles.length > 0 ? (
				<div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground select-text">
					<span className="font-medium">No preview</span> (binary or too large):{" "}
					{noPreviewFiles.map((f) => f.filename).join(", ")}
				</div>
			) : null}
		</div>
	);
}
