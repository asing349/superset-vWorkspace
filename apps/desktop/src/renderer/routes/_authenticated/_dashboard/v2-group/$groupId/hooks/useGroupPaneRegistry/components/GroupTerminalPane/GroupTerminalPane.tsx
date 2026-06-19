import type { RendererContext } from "@superset/panes";
import { cn } from "@superset/ui/utils";
import { workspaceTrpc } from "@superset/workspace-client";
import "@xterm/xterm/css/xterm.css";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useHotkey } from "renderer/hotkeys";
import {
	actionLabel,
	folderIntentFor,
	folderIntentLabel,
	LinkHoverHint,
	useTerminalFilePolicy,
	useTerminalUrlPolicy,
} from "renderer/lib/clickPolicy";
import {
	type ConnectionState,
	terminalRuntimeRegistry,
} from "renderer/lib/terminal/terminal-runtime-registry";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useLinkClickHint } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/hooks/useLinkClickHint";
import {
	type HoveredLink,
	useLinkHoverState,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/hooks/useLinkHoverState";
import { useTerminalAppearance } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/hooks/useTerminalAppearance";
import { shellEscapePaths } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/utils";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { openUrlInV2Workspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/utils/openUrlInV2Workspace";
import { useWorkspaceWsUrl } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceTrpcProvider/WorkspaceTrpcProvider";
import { ScrollToBottomButton } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/ScrollToBottomButton";
import { TerminalSearch } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/TerminalSearch";
import { useTheme } from "renderer/stores/theme";
import { resolveTerminalThemeType } from "renderer/stores/theme/utils";

interface GroupTerminalPaneProps {
	ctx: RendererContext<PaneViewerData>;
	terminalId: string;
	/**
	 * The specific root this terminal targets, for opening clicked file links
	 * into that root's editor pane. `null` for the combined agent-root terminal
	 * (its cwd is the synthetic parent dir spanning every root, which has no
	 * single owning root), in which case clickable file links are disabled.
	 */
	rootId: string | null;
	/**
	 * The targeting root's underlying `workspaceId`, used to validate (stat)
	 * file-path links via the existing `filesystem.statPath` procedure (which is
	 * `workspaceId`-addressed). `null` for `kind: "folder"` roots (no workspaceId)
	 * and the combined agent root, where file-link stat is disabled. Note that
	 * `statPath` resolves absolute paths host-wide (not confined to the root), so
	 * absolute terminal-output paths still resolve for workspace roots; only
	 * relative-path links depend on the root.
	 */
	statWorkspaceId: string | null;
	onOpenFile: (input: {
		rootId: string;
		filePath: string;
		openInNewTab?: boolean;
	}) => void;
}

/**
 * Group-scoped terminal pane — the multi-root analogue of the single-workspace
 * `TerminalPane`. It reuses the same renderer-side terminal runtime
 * (`terminalRuntimeRegistry`), search, scroll-to-bottom, link policies and
 * drop-to-paste, but is decoupled from `useWorkspace()`/`workspaceId`:
 *
 *  - The WS connection attaches by `terminalId` alone (no `workspaceId` query
 *    param). Group/agent sessions have a null `originWorkspaceId` on the host,
 *    so the host's workspace-mismatch check is skipped and the connection is
 *    keyed purely by terminalId. The session was already created (with its cwd
 *    and `SUPERSET_ROOTS` env) by `useGroupTerminalLauncher` before this pane
 *    mounts.
 *  - File-link `stat` uses the existing `filesystem.statPath` for a
 *    `kind: "workspace"` root (passing that root's `workspaceId`); statPath
 *    resolves absolute terminal-output paths host-wide. Folder roots (no
 *    workspaceId) and the combined agent terminal (`rootId === null`) have
 *    non-interactive file links.
 *  - Workspace-scoped niceties (the agent-binding icon, `listSessions`
 *    invalidation, and the per-workspace interrupt/clear run-status tracker) are
 *    intentionally omitted — they key on a `workspaceId` a group terminal lacks.
 */
export function GroupTerminalPane({
	ctx,
	terminalId,
	rootId,
	statWorkspaceId,
	onOpenFile,
}: GroupTerminalPaneProps) {
	const filePolicy = useTerminalFilePolicy();
	const urlPolicy = useTerminalUrlPolicy();
	const {
		hoveredLink,
		onHover: onLinkHover,
		onLeave: onLinkLeave,
	} = useLinkHoverState();
	const { hint, showHint } = useLinkClickHint();
	const terminalInstanceId = ctx.pane.id;
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);

	const appearance = useTerminalAppearance();
	const appearanceRef = useRef(appearance);
	appearanceRef.current = appearance;

	// themeType reaches the host-side respawn fallback so a restored shell gets
	// the right COLORFGBG; PTY env is set at spawn time only.
	const activeTheme = useTheme();
	const themeType = resolveTerminalThemeType({
		activeThemeType: activeTheme?.type,
	});
	// No `workspaceId` query param: group/agent sessions attach by terminalId and
	// carry a null originWorkspaceId on the host.
	const baseWebsocketUrl = useWorkspaceWsUrl(`/terminal/${terminalId}`);
	const themedUrl = new URL(baseWebsocketUrl);
	themedUrl.searchParams.set("themeType", themeType);
	const websocketUrl = themedUrl.toString();
	const websocketUrlRef = useRef(websocketUrl);
	websocketUrlRef.current = websocketUrl;

	// useCallback so useSyncExternalStore doesn't re-subscribe every render.
	const subscribe = useCallback(
		(callback: () => void) =>
			terminalRuntimeRegistry.onStateChange(
				terminalId,
				callback,
				terminalInstanceId,
			),
		[terminalId, terminalInstanceId],
	);
	const getSnapshot = useCallback(
		(): ConnectionState =>
			terminalRuntimeRegistry.getConnectionState(
				terminalId,
				terminalInstanceId,
			),
		[terminalId, terminalInstanceId],
	);
	const connectionState = useSyncExternalStore(subscribe, getSnapshot);

	// DOM-first lifecycle (mirrors TerminalPane): mount() attaches xterm
	// synchronously, connect() attaches the WebSocket to that terminalId. The
	// session is created up-front by the launcher, so by the time this runs the
	// host-service session already exists. Deps narrowed to terminal identity so
	// provider key remount churn doesn't re-run this; mutable inputs via refs.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		terminalRuntimeRegistry.mount(
			terminalId,
			container,
			appearanceRef.current,
			terminalInstanceId,
		);
		terminalRuntimeRegistry.connect(
			terminalId,
			websocketUrlRef.current,
			terminalInstanceId,
		);

		return () => {
			terminalRuntimeRegistry.detach(terminalId, terminalInstanceId);
		};
	}, [terminalId, terminalInstanceId]);

	useEffect(() => {
		if (!ctx.isActive) return;
		terminalRuntimeRegistry
			.getTerminal(terminalId, terminalInstanceId)
			?.focus();
	}, [ctx.isActive, terminalId, terminalInstanceId]);

	// Reconnect on base-URL change only (token refresh / host URL
	// re-resolution); themeType lives on the ref so a theme toggle doesn't tear
	// down a live shell.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		terminalRuntimeRegistry.reconnect(
			terminalId,
			websocketUrlRef.current,
			terminalInstanceId,
		);
	}, [terminalId, terminalInstanceId, baseWebsocketUrl]);

	useEffect(() => {
		terminalRuntimeRegistry.updateAppearance(
			terminalId,
			appearance,
			terminalInstanceId,
		);
	}, [terminalId, terminalInstanceId, appearance]);

	// --- Link handlers ---
	// File stat uses the existing workspaceId-addressed `filesystem.statPath`
	// for `kind: "workspace"` roots. statPath is a mutation (POST) to avoid tRPC
	// GET URL-encoding issues with paths containing special characters.
	const statPathMutation = workspaceTrpc.filesystem.statPath.useMutation();
	const statPathRef = useRef(statPathMutation.mutateAsync);
	statPathRef.current = statPathMutation.mutateAsync;

	useEffect(() => {
		terminalRuntimeRegistry.setLinkHandlers(
			terminalId,
			{
				stat: async (path) => {
					// No owning workspaceId (folder root / combined agent root): file
					// links are non-interactive — statPath is workspaceId-addressed.
					if (!rootId || !statWorkspaceId) return null;
					try {
						const result = await statPathRef.current({
							workspaceId: statWorkspaceId,
							path,
						});
						if (!result) return null;
						return {
							isDirectory: result.isDirectory,
							resolvedPath: result.resolvedPath,
						};
					} catch {
						return null;
					}
				},
				onFileLinkClick: (event, link) => {
					if (!rootId) return;
					if (link.isDirectory) {
						// Folder reveal in the explorer isn't wired for group terminals;
						// only file opens are supported. A modifier-less click shows the
						// hint, matching the single-workspace fallback.
						const intent = folderIntentFor(event);
						if (intent === null) {
							showHint(event.clientX, event.clientY);
						}
						return;
					}
					const action = filePolicy.getAction(event);
					if (action === null) {
						showHint(event.clientX, event.clientY);
						return;
					}
					event.preventDefault();
					// External-editor open is workspace-scoped (it resolves the
					// worktree/project); group terminals open every action ("pane",
					// "external") into the in-app editor, with "newTab" forcing a new tab.
					onOpenFile({
						rootId,
						filePath: link.resolvedPath,
						openInNewTab: action === "newTab",
					});
				},
				onUrlClick: (event, url) => {
					const action = urlPolicy.getAction(event);
					if (action === null) {
						showHint(event.clientX, event.clientY);
						return;
					}
					event.preventDefault();
					if (action === "external") {
						electronTrpcClient.external.openUrl.mutate(url).catch((error) => {
							console.error(
								"[v2 Group Terminal] Failed to open URL:",
								url,
								error,
							);
						});
					} else {
						openUrlInV2Workspace({
							store: ctx.store,
							target: action === "newTab" ? "new-tab" : "current-tab",
							url,
						});
					}
				},
				onLinkHover,
				onLinkLeave,
			},
			terminalInstanceId,
		);
	}, [
		terminalId,
		terminalInstanceId,
		rootId,
		statWorkspaceId,
		ctx.store,
		onOpenFile,
		onLinkHover,
		onLinkLeave,
		showHint,
		filePolicy,
		urlPolicy,
	]);

	useHotkey(
		"CLEAR_TERMINAL",
		() => {
			terminalRuntimeRegistry.clear(terminalId, terminalInstanceId);
		},
		{ enabled: ctx.isActive },
	);

	useHotkey(
		"SCROLL_TO_BOTTOM",
		() => {
			terminalRuntimeRegistry.scrollToBottom(terminalId, terminalInstanceId);
		},
		{ enabled: ctx.isActive },
	);

	useHotkey("FIND_IN_TERMINAL", () => setIsSearchOpen((prev) => !prev), {
		enabled: ctx.isActive,
		preventDefault: true,
	});

	// connectionState in deps ensures the terminal ref re-derives after
	// connect/disconnect.
	// biome-ignore lint/correctness/useExhaustiveDependencies: connectionState intentionally re-derives
	const terminal = useMemo(
		() => terminalRuntimeRegistry.getTerminal(terminalId, terminalInstanceId),
		[terminalId, terminalInstanceId, connectionState],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: connectionState intentionally re-derives
	const searchAddon = useMemo(
		() =>
			terminalRuntimeRegistry.getSearchAddon(terminalId, terminalInstanceId),
		[terminalId, terminalInstanceId, connectionState],
	);

	const [isDropActive, setIsDropActive] = useState(false);
	const dragCounterRef = useRef(0);

	const resolveDroppedText = (dataTransfer: DataTransfer): string | null => {
		const files = Array.from(dataTransfer.files);
		if (files.length > 0) {
			const paths = files
				.map((file) => window.webUtils.getPathForFile(file))
				.filter(Boolean);
			return paths.length > 0 ? shellEscapePaths(paths) : null;
		}
		const plainText = dataTransfer.getData("text/plain");
		return plainText ? shellEscapePaths([plainText]) : null;
	};

	const handleDragEnter = (event: React.DragEvent) => {
		event.preventDefault();
		dragCounterRef.current += 1;
		setIsDropActive(true);
	};

	const handleDragOver = (event: React.DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	};

	const handleDragLeave = (event: React.DragEvent) => {
		event.preventDefault();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current <= 0) {
			dragCounterRef.current = 0;
			setIsDropActive(false);
		}
	};

	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault();
		dragCounterRef.current = 0;
		setIsDropActive(false);
		if (connectionState === "closed") return;
		const text = resolveDroppedText(event.dataTransfer);
		if (!text) return;
		terminalRuntimeRegistry
			.getTerminal(terminalId, terminalInstanceId)
			?.focus();
		terminalRuntimeRegistry.paste(terminalId, text, terminalInstanceId);
	};

	return (
		<div
			role="application"
			className="relative flex h-full w-full flex-col p-2"
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<TerminalSearch
					searchAddon={searchAddon}
					isOpen={isSearchOpen}
					onClose={() => setIsSearchOpen(false)}
				/>
				<div
					ref={containerRef}
					className="h-full w-full"
					style={{ backgroundColor: appearance.background }}
				/>
				<ScrollToBottomButton terminal={terminal} />
			</div>
			<div
				className={cn(
					"pointer-events-none absolute inset-0 bg-primary/10 transition-opacity duration-100",
					isDropActive ? "opacity-75" : "opacity-0",
				)}
			/>
			{connectionState === "closed" && (
				<div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
					<span>Disconnected</span>
				</div>
			)}
			<LinkHoverHint
				hoverLabel={resolveHoverLabel(hoveredLink, filePolicy, urlPolicy)}
				hoverPosition={hoveredLink}
				clickHint={hint}
			/>
		</div>
	);
}

// Compute "what would clicking right now do?" for the live link tooltip
// (mirrors TerminalPane.resolveHoverLabel).
function resolveHoverLabel(
	hovered: HoveredLink | null,
	filePolicy: ReturnType<typeof useTerminalFilePolicy>,
	urlPolicy: ReturnType<typeof useTerminalUrlPolicy>,
): string | null {
	if (!hovered) return null;
	const event = {
		metaKey: hovered.modifier,
		ctrlKey: false,
		shiftKey: hovered.shift,
	};
	if (hovered.info.kind === "url") {
		const action = urlPolicy.getAction(event);
		return action ? actionLabel(action, "url") : null;
	}
	if (hovered.info.isDirectory) {
		return folderIntentLabel(folderIntentFor(event));
	}
	const action = filePolicy.getAction(event);
	return action ? actionLabel(action, "file") : null;
}
