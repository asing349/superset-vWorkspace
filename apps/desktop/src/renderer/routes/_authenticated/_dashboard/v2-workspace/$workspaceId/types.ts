export interface FilePaneData {
	filePath: string;
	mode: "editor" | "diff" | "preview";
	language?: string;
	viewId?: string;
	forceViewId?: string;
	/**
	 * Multi-root workspace ("group") addressing. Identifies which root of the
	 * group this file belongs to. Optional: when unset, the pane belongs to the
	 * route's single workspace and filesystem calls use the `{ workspaceId }`
	 * addressing (unchanged single-workspace behavior). In the group shell (M3)
	 * it is always set, and filesystem reads/writes route via the root's FS
	 * service using the `{ groupId, rootId }` addressing.
	 */
	rootId?: string;
	/**
	 * 1-based line to scroll to + place the cursor on when the editor opens
	 * (A3). Set by callers that know a target location — e.g. a content-search or
	 * quick-open hit. Unset means "open at the top" (unchanged). Mirrors the
	 * `DiffPaneData.focusLine`/`focusTick` pattern.
	 */
	focusLine?: number;
	/** 1-based column paired with `focusLine`; defaults to column 1 when absent. */
	focusColumn?: number;
	/**
	 * Bumped on each focus request so clicking the SAME line again re-scrolls
	 * (the editor effect re-runs only when this changes). Mirrors
	 * `DiffPaneData.focusTick`.
	 */
	focusTick?: number;
}

export interface TerminalPaneData {
	terminalId: string;
	/**
	 * Multi-root workspace ("group") addressing — the root this terminal targets.
	 * Optional: unset for single-workspace terminals (the route's workspace).
	 * In the group shell a terminal is created against a specific root's
	 * worktree/folder; M6 wires per-root terminal creation through this.
	 */
	rootId?: string;
}

export interface ChatPaneData {
	sessionId: string | null;
	/**
	 * Transient initial launch config for a freshly-opened chat pane.
	 * Cleared by the chat pane on first consume. Set by the V2 workspace
	 * page's useConsumePendingLaunch when a pending chat launch exists.
	 */
	launchConfig?: {
		initialPrompt?: string;
		initialFiles?: Array<{
			data: string;
			mediaType: string;
			filename?: string;
		}>;
		model?: string;
		taskSlug?: string;
	} | null;
}

export interface BrowserPaneData {
	url: string;
	pageTitle?: string;
	faviconUrl?: string | null;
}

export interface DevtoolsPaneData {
	targetPaneId: string;
	targetTitle: string;
}

export type DiffFocusSide = "deletions" | "additions";

export interface DiffPaneData {
	path: string;
	collapsedFiles: string[];
	/** Line to scroll to within `path`. `focusTick` bumps on each request
	 *  so repeated clicks of the same line still re-scroll. */
	focusLine?: number;
	focusSide?: DiffFocusSide;
	focusTick?: number;
	/**
	 * Multi-root workspace ("group") addressing — the root whose git changeset
	 * this diff renders. Optional: unset for single-workspace diffs (the route's
	 * workspace). In the group shell the Changes view sets this to the
	 * `kind: "workspace"` root's `rootId`; git reads still route by that root's
	 * `workspaceId`. Folder roots that are not git repos have no diff pane.
	 */
	rootId?: string;
}

export interface CommentPaneData {
	commentId: string;
	authorLogin: string;
	avatarUrl?: string;
	body: string;
	url?: string;
	path?: string;
	line?: number;
}

/**
 * Superset Memory panel (B4b/B5/B6/B7b). One pane per workspace surfaces the
 * local memory layer: the token-savings stat, the Playbook browser,
 * consolidation (B5 "practice"), the knowledge graph (B6 "graph"), and the
 * optional embeddings toggle (B7b "settings"). `section` selects which sub-tab
 * is active; `selectedPlaybookId` remembers the open Playbook detail.
 */
export interface MemoryPaneData {
	/** Active section/sub-tab: playbooks + practice + graph + settings. */
	section?: "playbooks" | "practice" | "graph" | "settings";
	/** The Playbook whose detail is open, if any. */
	selectedPlaybookId?: string | null;
}

export type PaneViewerData =
	| FilePaneData
	| TerminalPaneData
	| ChatPaneData
	| BrowserPaneData
	| DevtoolsPaneData
	| DiffPaneData
	| CommentPaneData
	| MemoryPaneData;
