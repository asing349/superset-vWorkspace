import { useWorkspaceClient } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import { useTheme } from "renderer/stores/theme";
import { resolveTerminalThemeType } from "renderer/stores/theme/utils";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";

interface CreateRootOptions {
	/**
	 * If provided, the launcher uses this id instead of minting one. Use it when
	 * you already have a terminalId (e.g. rehydrating from a persisted pane
	 * layout). host-service createSession is idempotent: existing in-memory
	 * session → no-op; daemon PTY survived a host-service restart → adopt;
	 * nothing exists → spawn fresh.
	 */
	terminalId?: string;
	command?: string;
	cwd?: string;
}

export interface GroupTerminalLauncher {
	/**
	 * Create a terminal session targeting one specific root of the group. The
	 * host resolves `{ groupId, rootId }` to that root's absolute worktree/folder
	 * path and spawns the PTY there (cwd = the root's path). Works for
	 * `kind: "folder"` roots too (they have no `workspaceId`); the host session's
	 * `originWorkspaceId` is null in that case. Returns the terminalId.
	 *
	 * Callers should await this before writing the pane into the store, so the
	 * pane's WebSocket connect doesn't race ahead of the session existing on
	 * host-service.
	 */
	createForRoot(input: {
		rootId: string;
		options?: CreateRootOptions;
	}): Promise<string>;
	/**
	 * Launch the combined agent root: idempotently prepares the group's synthetic
	 * parent directory (one symlink per existing root, via
	 * `workspaceGroup.prepareAgentRoot`), then creates a terminal session whose
	 * cwd is that `agentRootPath`. The host also exports `SUPERSET_ROOTS` (one
	 * line per root path) into the PTY so an agent started there can enumerate
	 * every root. Returns the terminalId.
	 */
	createAgentRoot(options?: CreateRootOptions): Promise<string>;
}

/**
 * Group analogue of `useV2TerminalLauncher`. Where the single-workspace launcher
 * addresses the host with `{ workspaceId }`, this one addresses it with the
 * finalized M6 host contract:
 *  - per-root terminals → `{ rootTarget: { groupId, rootId } }`
 *  - combined agent root → `prepareAgentRoot({ groupId })` then
 *    `{ rootTarget: { groupId, agentRoot: true } }`.
 *
 * It reuses the single `WorkspaceClientProvider` opened by
 * `WorkspaceGroupProvider` (no extra host connection), mirroring how the M3
 * group hooks reuse that one connection.
 */
export function useGroupTerminalLauncher(): GroupTerminalLauncher {
	const { groupId } = useWorkspaceGroup();
	const { trpcClient } = useWorkspaceClient();
	const activeTheme = useTheme();
	const themeType = resolveTerminalThemeType({
		activeThemeType: activeTheme?.type,
	});

	const createForRoot = useCallback(
		async ({
			rootId,
			options,
		}: {
			rootId: string;
			options?: CreateRootOptions;
		}): Promise<string> => {
			const terminalId = options?.terminalId ?? crypto.randomUUID();
			await trpcClient.terminal.createSession.mutate({
				terminalId,
				rootTarget: { groupId, rootId },
				themeType,
				initialCommand: options?.command,
				cwd: options?.cwd,
			});
			return terminalId;
		},
		[trpcClient, groupId, themeType],
	);

	const createAgentRoot = useCallback(
		async (options?: CreateRootOptions): Promise<string> => {
			const terminalId = options?.terminalId ?? crypto.randomUUID();
			// Wave-2 M5: EVERY combined-agent launch re-runs prepareAgentRoot — there
			// is no cache or skip here, so the synthetic symlink dir is always
			// reconciled to the CURRENT roots before the PTY spawns (add/remove/
			// promote since the last launch is picked up). prepareAgentRoot is
			// idempotent and serialized per-group on the host (Wave-2 M2), so the
			// deliberate double-invoke (here + createSession's internal call with
			// `agentRoot: true`) is safe. Calling it explicitly here also lets a
			// future UI surface the resolved agentRootPath without spawning a
			// terminal.
			await trpcClient.workspaceGroup.prepareAgentRoot.mutate({ groupId });
			await trpcClient.terminal.createSession.mutate({
				terminalId,
				rootTarget: { groupId, agentRoot: true },
				themeType,
				initialCommand: options?.command,
				cwd: options?.cwd,
			});
			return terminalId;
		},
		[trpcClient, groupId, themeType],
	);

	// Memoize so the launcher reference is stable across renders (consumers list
	// it in deps arrays), mirroring useV2TerminalLauncher.
	return useMemo<GroupTerminalLauncher>(
		() => ({ createForRoot, createAgentRoot }),
		[createForRoot, createAgentRoot],
	);
}
