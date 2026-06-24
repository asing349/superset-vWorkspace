import type { CodeViewItem } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import type { DiffAnnotationMetadata } from "../../../DiffPane/hooks/useDiffAnnotations";
import { useDiffCodeViewTheme } from "../../../DiffPane/hooks/useDiffCodeViewTheme";
import { buildPrDiffItems } from "../../utils/buildPrDiffItems";

interface PrDiffViewProps {
	/** v2 project the PR belongs to (`workspace.projectId`). */
	projectId: string;
	prNumber: number;
}

/**
 * The Diff tab of the PR-review window (Wave 5, M2). Renders an ARBITRARY repo
 * PR's `base..head` diff — a PR that may NOT be checked out locally.
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
 * minimal correct path. Anchor wiring (scroll-to-file) lands in M5.
 */
export function PrDiffView({ projectId, prNumber }: PrDiffViewProps) {
	const { options, style } = useDiffCodeViewTheme();

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
