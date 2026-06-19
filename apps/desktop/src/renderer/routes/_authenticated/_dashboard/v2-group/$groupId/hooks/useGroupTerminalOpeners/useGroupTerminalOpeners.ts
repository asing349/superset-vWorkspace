import type { WorkspaceStore } from "@superset/panes";
import { useCallback, useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type {
	PaneViewerData,
	TerminalPaneData,
} from "../../../../v2-workspace/$workspaceId/types";
import { useGroupTerminalLauncher } from "../useGroupTerminalLauncher";

export interface GroupTerminalOpeners {
	/**
	 * Open a terminal targeting a specific root: creates the host session with
	 * `{ rootTarget: { groupId, rootId } }` (cwd = that root's worktree/folder),
	 * awaits it, then adds a terminal tab stamped with the `rootId` so the pane's
	 * WS connect attaches to the now-existing session and the pane renders the
	 * right root context.
	 */
	openRootTerminal: (rootId: string) => Promise<void>;
	/**
	 * Launch the combined agent: prepares the group's synthetic agent root (one
	 * symlink per root) and creates a terminal session with cwd = agentRootPath
	 * (PTY also gets `SUPERSET_ROOTS`), then adds a terminal tab with no `rootId`
	 * (it spans every root). An agent started here can see all roots at once.
	 */
	openAgentTerminal: () => Promise<void>;
}

/**
 * Create-then-add-tab helpers for the multi-root workspace ("group") shell —
 * the group analogue of `useWorkspacePaneOpeners.addTerminalTab`. The host
 * `createSession` is awaited before the pane is written into the store so the
 * pane's WebSocket connect doesn't race ahead of the session.
 */
export function useGroupTerminalOpeners({
	store,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): GroupTerminalOpeners {
	const launcher = useGroupTerminalLauncher();

	const openRootTerminal = useCallback(
		async (rootId: string) => {
			const terminalId = await launcher.createForRoot({ rootId });
			store.getState().addTab({
				panes: [
					{
						kind: "terminal",
						data: { terminalId, rootId } as TerminalPaneData,
					},
				],
			});
		},
		[launcher, store],
	);

	const openAgentTerminal = useCallback(async () => {
		const terminalId = await launcher.createAgentRoot();
		store.getState().addTab({
			panes: [
				{
					kind: "terminal",
					// No rootId: the combined agent root spans every root.
					data: { terminalId } as TerminalPaneData,
				},
			],
		});
	}, [launcher, store]);

	return useMemo<GroupTerminalOpeners>(
		() => ({ openRootTerminal, openAgentTerminal }),
		[openRootTerminal, openAgentTerminal],
	);
}
