import type { PaneRegistry, RendererContext } from "@superset/panes";
import { cn } from "@superset/ui/utils";
import { Circle, TerminalSquare } from "lucide-react";
import { useMemo } from "react";
import { FileIcon } from "renderer/lib/fileIcons";
import { getBaseName } from "renderer/lib/pathBasename";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
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
	TerminalPaneData,
} from "../../../../v2-workspace/$workspaceId/types";
import {
	type ResolvedGroupRoot,
	useWorkspaceGroup,
} from "../../providers/WorkspaceGroupProvider";
import { GroupReadOnlyFilePane } from "./components/GroupReadOnlyFilePane";
import { GroupTerminalPane } from "./components/GroupTerminalPane";

/** A file-link open request originating from a group terminal pane. */
export interface GroupTerminalOpenFileInput {
	rootId: string;
	filePath: string;
	openInNewTab?: boolean;
}

/**
 * Addressing for a terminal file-link `filesystem.statPath` call — the same
 * `{ workspaceId } | { groupId, rootId }` union the host `statPath` procedure
 * accepts (wave-2 M7 widened `statPath` to the shared addressing union). Passed
 * to `GroupTerminalPane`, which spreads it into the `statPath` mutation input.
 *
 * - `kind: "workspace"` roots stat via `{ workspaceId }` (unchanged behavior).
 * - `kind: "folder"` roots and the combined-agent root stat via
 *   `{ groupId, rootId }`. For ABSOLUTE terminal-output paths the host ignores
 *   the resolved root entirely (it stats the absolute path host-wide), so any
 *   resolvable `{ groupId, rootId }` of the group makes absolute agent/folder
 *   paths clickable; for RELATIVE paths the root supplies the join base.
 */
export type GroupTerminalStatAddressing =
	| { workspaceId: string }
	| { groupId: string; rootId: string };

/**
 * The stat addressing + the `rootId` to stamp on a clicked-open file pane, for a
 * given terminal pane's `rootId`. `null` addressing → file links are
 * non-interactive (no resolvable root); `openRootId` is the root a clicked path
 * opens under (it namespaces the editor document cache + supplies read
 * addressing — absolute paths still open host-wide via that root's FS service).
 */
interface GroupTerminalLinkTarget {
	statAddressing: GroupTerminalStatAddressing | null;
	openRootId: string | null;
}

function getFileName(filePath: string): string {
	return getBaseName(filePath);
}

/**
 * Resolve the underlying `workspaceId` to use for a file pane's shared document.
 *
 * - `kind: "workspace"` roots carry a real `workspaceId` (the document cache key
 *   + the workspaceId-addressed read/write path). Editable. Unchanged.
 * - `kind: "folder"` roots have NO `workspaceId`. Wave-2 M1 made the host
 *   filesystem WRITE procedures group-addressable, so a folder root that
 *   resolves on disk (`exists !== false`) is now EDITABLE through the same
 *   `FilePane`: reads AND writes route via `{ groupId, rootId }` (group
 *   addressing, threaded by `FilePane` from `groupId` + the pane's `rootId`).
 *   We still key the renderer-side document cache by a stable `folder:<rootId>`
 *   surrogate so distinct folder-root files don't collide.
 * - A root that does not resolve on disk (`exists === false`) — or an
 *   unknown/unmatched `rootId` — stays read-only via `GroupReadOnlyFilePane`
 *   (there is no writable target for it).
 */
function resolveDocumentWorkspaceId(root: ResolvedGroupRoot | null): {
	workspaceId: string;
	readOnly: boolean;
} {
	if (root && root.kind === "workspace" && root.workspaceId) {
		return { workspaceId: root.workspaceId, readOnly: false };
	}
	if (root && root.kind === "folder") {
		// Editable when the folder resolves on disk. Group addressing
		// ({ groupId, rootId }) carries both reads and writes; the synthetic key
		// only namespaces the renderer-side document cache.
		return {
			workspaceId: `folder:${root.rootId}`,
			readOnly: root.exists === false,
		};
	}
	// Unknown/unresolved root — no writable target; render read-only.
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
 * M3 scope: the `file` pane (the only path-bearing pane wired in M3). M6 adds
 * the `terminal` pane (per-root + combined-agent terminals). Chat, browser,
 * diff, and comment panes are added as their group wiring lands.
 */
export function useGroupPaneRegistry({
	onOpenFile,
}: {
	/**
	 * Open a file clicked in a group terminal's output into the editor area,
	 * stamped with the originating terminal's `rootId`. Wired to
	 * `useGroupFileNavigation.openFilePane` by the group page.
	 */
	onOpenFile: (input: GroupTerminalOpenFileInput) => void;
}): PaneRegistry<PaneViewerData> {
	// `roots` is a stable, memoized array from WorkspaceGroupProvider, so the
	// registry memo depends on it directly. `group` carries `defaultRootId`,
	// used to pick the combined-agent terminal's stat/open fallback root.
	const { groupId, group, roots } = useWorkspaceGroup();
	const defaultRootId = group.defaultRootId;

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

		// The default/first resolvable root, used as the stat + open target for
		// the combined-agent terminal (which has no `rootId` of its own). The
		// agent's cwd is the synthetic root spanning every member root, so no
		// single root is "the" root; we pick the group's default root (else the
		// first that resolves on disk) as a valid, deterministic
		// `{ groupId, rootId }` base. Absolute agent-output paths — the dominant
		// case, exactly what `SUPERSET_ROOTS` advertises — stat host-wide
		// regardless of which root is passed; relative paths use this root's path
		// as the join base.
		const agentFallbackRoot =
			roots.find((root) => root.rootId === defaultRootId) ??
			roots.find((root) => root.exists !== false) ??
			null;

		// Resolve the stat addressing + open-target rootId for a terminal pane's
		// `rootId`. Threads `groupId` (group context) and the pane's `rootId` into
		// the shared `{ workspaceId } | { groupId, rootId }` addressing union:
		//   - `kind: "workspace"` root → `{ workspaceId }` (unchanged).
		//   - `kind: "folder"` root that resolves → `{ groupId, rootId }`.
		//   - combined-agent terminal (`rootId` undefined) → the default/first
		//     resolvable root's `{ groupId, rootId }`.
		// Anything that can't be resolved → `null` addressing, so the file link
		// stays non-interactive (graceful fallback, no crash), as before.
		const resolveTerminalLinkTarget = (
			rootId: string | undefined,
		): GroupTerminalLinkTarget => {
			if (!rootId) {
				// Combined-agent root: route via the fallback root's group addressing.
				if (!agentFallbackRoot) {
					return { statAddressing: null, openRootId: null };
				}
				return {
					statAddressing: { groupId, rootId: agentFallbackRoot.rootId },
					openRootId: agentFallbackRoot.rootId,
				};
			}
			const root = rootsById.get(rootId) ?? null;
			if (!root || root.exists === false) {
				return { statAddressing: null, openRootId: null };
			}
			if (root.kind === "workspace" && root.workspaceId) {
				return {
					statAddressing: { workspaceId: root.workspaceId },
					openRootId: rootId,
				};
			}
			// Folder root (or a workspace root missing its workspaceId): stat via
			// group addressing, which `getServiceForRootId` resolves to the root's
			// real path.
			return {
				statAddressing: { groupId, rootId },
				openRootId: rootId,
			};
		};

		// Human label for a terminal's targeting root, shown until the PTY reports
		// its own title. The combined agent root (no rootId) is labelled "Agent".
		const resolveTerminalLabel = (rootId: string | undefined): string => {
			if (!rootId) return "Agent";
			const root = rootsById.get(rootId) ?? null;
			return root?.label ?? "Terminal";
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
					// Editable roots (workspace roots, and — since wave-2 M1 —
					// resolvable folder roots) render the editable FilePane: reads AND
					// writes route via the pane's addressing ({ groupId, rootId } for
					// folder roots, { workspaceId } for workspace roots). Only
					// genuinely unresolvable roots (exists: false) stay read-only.
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
					// Unresolvable (read-only) panes show no editor header extras (view
					// toggles / external-editor open) — they have no editable surface.
					// Resolvable folder roots are editable (wave-2 M1) and get them.
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
					const { workspaceId, readOnly, groupAddressing } =
						resolveForPane(data);
					// Read-only panes (unresolvable roots) never become dirty and can
					// close freely. Editable folder roots fall through to the dirty
					// check below, exactly like workspace roots (wave-2 M1).
					if (readOnly) return true;
					// (wave-2 M2 fix) Thread the pane's group addressing into the dirty
					// lookup. The document cache keys by `(addressing, absolutePath)`
					// since M2, so a dirty GROUP-ROOT doc is only found when the matching
					// `{ groupId, rootId }` is supplied — without it, a dirty folder-root
					// file would close without the unsaved-changes guard firing.
					const doc = getDocument(workspaceId, data.filePath, groupAddressing);
					return !doc?.dirty;
				},
				contextMenuActions: (_ctx, defaults) =>
					defaults.map((d) =>
						d.key === "close-pane" ? { ...d, label: "Close File" } : d,
					),
			},
			terminal: {
				getIcon: () => <TerminalSquare className="size-3.5 shrink-0" />,
				getTitle: (pane) =>
					resolveTerminalLabel((pane.data as TerminalPaneData).rootId),
				// Live PTY title (e.g. the running command/agent) once it reports
				// one, falling back to the root label.
				titleSource: (pane) => {
					const { terminalId } = pane.data as TerminalPaneData;
					const instanceId = pane.id;
					return {
						subscribe: (callback) =>
							terminalRuntimeRegistry.onTitleChange(
								terminalId,
								callback,
								instanceId,
							),
						getSnapshot: () =>
							terminalRuntimeRegistry
								.getTitle(terminalId, instanceId)
								?.trim() || undefined,
					};
				},
				onAfterClose: (pane) => {
					// Group/agent terminal sessions have no owning workspaceId, so the
					// workspaceId-keyed killSession path doesn't apply. Disposing the
					// renderer runtime tears down the transport and lets the host PTY
					// exit when its socket closes.
					const { terminalId } = pane.data as TerminalPaneData;
					terminalRuntimeRegistry.dispose(terminalId);
				},
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as TerminalPaneData;
					const { statAddressing, openRootId } = resolveTerminalLinkTarget(
						data.rootId,
					);
					return (
						<GroupTerminalPane
							ctx={ctx}
							terminalId={data.terminalId}
							openRootId={openRootId}
							statAddressing={statAddressing}
							onOpenFile={onOpenFile}
						/>
					);
				},
				contextMenuActions: (_ctx, defaults) =>
					defaults.map((d) =>
						d.key === "close-pane" ? { ...d, label: "Close Terminal" } : d,
					),
			},
		};
	}, [groupId, defaultRootId, roots, onOpenFile]);
}
