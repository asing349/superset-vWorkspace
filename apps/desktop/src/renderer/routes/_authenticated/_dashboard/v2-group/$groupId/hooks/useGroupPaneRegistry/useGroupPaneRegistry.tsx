import type { PaneRegistry, RendererContext } from "@superset/panes";
import { cn } from "@superset/ui/utils";
import { Circle } from "lucide-react";
import { useMemo } from "react";
import { FileIcon } from "renderer/lib/fileIcons";
import { getBaseName } from "renderer/lib/pathBasename";
import { FilePane } from "../../../../v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane";
import { FilePaneHeaderExtras } from "../../../../v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/FilePaneHeaderExtras";
import {
	type FileDocumentGroupAddressing,
	getDocument,
	useSharedFileDocument,
} from "../../../../v2-workspace/$workspaceId/state/fileDocumentStore";
import type {
	FilePaneData,
	PaneViewerData,
} from "../../../../v2-workspace/$workspaceId/types";
import {
	type ResolvedGroupRoot,
	useWorkspaceGroup,
} from "../../providers/WorkspaceGroupProvider";
import { GroupReadOnlyFilePane } from "./components/GroupReadOnlyFilePane";

function getFileName(filePath: string): string {
	return getBaseName(filePath);
}

/**
 * Resolve the underlying `workspaceId` to use for a file pane's shared document.
 *
 * Per the M2 contract: `kind: "workspace"` roots carry a real `workspaceId`
 * (the document cache key + the workspaceId-only write path). `kind: "folder"`
 * roots have no `workspaceId` — their reads are carried by `{ groupId, rootId }`
 * (group addressing), and writes are NOT yet supported by the host contract.
 * For folder roots we key the document cache by a stable `folder:<rootId>`
 * surrogate so distinct folder-root files don't collide; saves are gated
 * (read-only) below.
 */
function resolveDocumentWorkspaceId(root: ResolvedGroupRoot | null): {
	workspaceId: string;
	readOnly: boolean;
} {
	if (root && root.kind === "workspace" && root.workspaceId) {
		return { workspaceId: root.workspaceId, readOnly: false };
	}
	if (root && root.kind === "folder") {
		// Folder-root writes are unsupported by the host contract today; reads
		// route via { groupId, rootId }. The synthetic key only namespaces the
		// renderer-side document cache.
		return { workspaceId: `folder:${root.rootId}`, readOnly: true };
	}
	// Unknown/unresolved root — treat as read-only with a rootId-scoped key.
	return {
		workspaceId: root ? `root:${root.rootId}` : "group-unknown",
		readOnly: true,
	};
}

function GroupFilePaneTabTitle({
	filePath,
	isActive,
	pinned,
	workspaceId,
	groupAddressing,
}: {
	filePath: string;
	isActive: boolean;
	pinned: boolean;
	workspaceId: string;
	groupAddressing: FileDocumentGroupAddressing | null;
}) {
	const document = useSharedFileDocument({
		workspaceId,
		absolutePath: filePath,
		groupAddressing,
	});
	const name = getFileName(filePath);
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-1.5 text-xs transition-colors duration-150",
				isActive ? "text-foreground" : "text-muted-foreground",
			)}
			title={filePath}
		>
			<FileIcon fileName={name} className="size-3.5 shrink-0" />
			<span className={cn("min-w-0 truncate", !pinned && "italic")}>
				{name}
			</span>
			{document.dirty && (
				<Circle className="size-2 shrink-0 fill-current text-muted-foreground" />
			)}
		</div>
	);
}

/**
 * Group-scoped pane registry for the multi-root workspace ("group") shell.
 *
 * Unlike the single-workspace `usePaneRegistry` (bound to one ambient
 * `useWorkspace()` workspace), this registry resolves each file pane's
 * underlying `workspaceId` from the pane's own `rootId` → root mapping, and
 * threads the real `groupId` so filesystem reads route via `{ groupId, rootId }`
 * (the M2 seam). It opens no additional host connection — it reuses the single
 * `WorkspaceClientProvider` opened by `WorkspaceGroupProvider`.
 *
 * M3 scope: the `file` pane (the only path-bearing pane wired in M3). Terminal,
 * chat, browser, diff, and comment panes are added in M4/M6 as their group
 * wiring lands; until then the group shell renders an empty pane area.
 */
export function useGroupPaneRegistry(): PaneRegistry<PaneViewerData> {
	// `roots` is a stable, memoized array from WorkspaceGroupProvider, so the
	// registry memo depends on it directly.
	const { groupId, roots } = useWorkspaceGroup();

	return useMemo<PaneRegistry<PaneViewerData>>(() => {
		const rootsById = new Map<string, ResolvedGroupRoot>(
			roots.map((root) => [root.rootId, root]),
		);
		const resolveForPane = (data: FilePaneData) => {
			const root = data.rootId ? (rootsById.get(data.rootId) ?? null) : null;
			const { workspaceId, readOnly } = resolveDocumentWorkspaceId(root);
			const groupAddressing: FileDocumentGroupAddressing | null =
				data.rootId !== undefined ? { groupId, rootId: data.rootId } : null;
			return { workspaceId, readOnly, groupAddressing };
		};

		return {
			file: {
				getIcon: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					return (
						<FileIcon
							fileName={getFileName(data.filePath)}
							className="size-4"
						/>
					);
				},
				getTitle: (pane) => getFileName((pane.data as FilePaneData).filePath),
				renderTitle: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					const { workspaceId, groupAddressing } = resolveForPane(data);
					return (
						<GroupFilePaneTabTitle
							filePath={data.filePath}
							isActive={ctx.isActive}
							pinned={Boolean(ctx.pane.pinned)}
							workspaceId={workspaceId}
							groupAddressing={groupAddressing}
						/>
					);
				},
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					const { workspaceId, readOnly, groupAddressing } =
						resolveForPane(data);
					// Folder roots have no host write path → render read-only (the save
					// path is never wired). Workspace roots use the editable FilePane:
					// reads route via { groupId, rootId }; workspaceId is the document
					// cache key + the workspaceId-only write path.
					if (readOnly) {
						return (
							<GroupReadOnlyFilePane
								filePath={data.filePath}
								workspaceId={workspaceId}
								groupAddressing={groupAddressing}
							/>
						);
					}
					return (
						<FilePane
							context={ctx}
							workspaceId={workspaceId}
							groupId={groupId}
						/>
					);
				},
				renderHeaderExtras: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					const { workspaceId, readOnly } = resolveForPane(data);
					// Read-only folder-root panes show no editor header extras (view
					// toggles / external-editor open) — they have no editable surface.
					if (readOnly) return null;
					return (
						<FilePaneHeaderExtras
							context={ctx}
							workspaceId={workspaceId}
							groupId={groupId}
						/>
					);
				},
				onHeaderClick: (ctx: RendererContext<PaneViewerData>) =>
					ctx.actions.pin(),
				onBeforeClose: (pane) => {
					const data = pane.data as FilePaneData;
					const { workspaceId, readOnly } = resolveForPane(data);
					// Folder-root files are read-only (folder writes unsupported by the
					// host contract), so they never become dirty and can close freely.
					if (readOnly) return true;
					const doc = getDocument(workspaceId, data.filePath);
					return !doc?.dirty;
				},
				contextMenuActions: (_ctx, defaults) =>
					defaults.map((d) =>
						d.key === "close-pane" ? { ...d, label: "Close File" } : d,
					),
			},
		};
	}, [groupId, roots]);
}
