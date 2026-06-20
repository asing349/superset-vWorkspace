import { getEventBus } from "@superset/workspace-client";
import type { FsWatchEvent } from "@superset/workspace-fs/client";
import { useEffect, useEffectEvent } from "react";
import { getHostServiceWsToken } from "renderer/lib/host-service-auth";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

/**
 * Subscribe to the group-addressed `fs:groupEvents` channel for a single
 * `{ groupId, rootId }` root of a multi-root workspace ("group") — the sibling
 * of {@link import("../useWorkspaceEvent").useWorkspaceEvent} for folder roots,
 * which have no `workspaceId` (Wave-2 M6).
 *
 * Host resolution: groups are local-only / same-host (wave-1 A1; the group
 * shell connects to `useLocalHostService().activeHostUrl`), so the watch reuses
 * the SAME single multiplexed per-host socket the group's tRPC + workspace
 * `fs:events` already share. No second connection is opened.
 *
 * Like `useWorkspaceEvent("fs:events", …)`, this flattens the batched
 * `events: FsWatchEvent[]` payload and invokes `callback` once per event, and
 * ref-counts the `fs:watchGroup`/`fs:unwatchGroup` watch + `bus.retain()` so
 * the connection tears down cleanly when the last subscriber unmounts.
 */
export function useWorkspaceGroupEvent(
	_type: "fs:groupEvents",
	address: { groupId: string; rootId: string },
	callback: (event: FsWatchEvent) => void,
	enabled = true,
): void {
	const { activeHostUrl } = useLocalHostService();
	const handler = useEffectEvent(callback);
	const { groupId, rootId } = address;

	useEffect(() => {
		if (!enabled || !activeHostUrl || !groupId || !rootId) return;

		const bus = getEventBus(activeHostUrl, () =>
			getHostServiceWsToken(activeHostUrl),
		);
		const cleanups: Array<() => void> = [];

		bus.watchFsGroup({ groupId, rootId });
		const removeListener = bus.onFsGroup(
			{ groupId, rootId },
			(_address, payload) => {
				for (const event of payload.events) {
					handler(event);
				}
			},
		);
		cleanups.push(removeListener, () =>
			bus.unwatchFsGroup({ groupId, rootId }),
		);
		cleanups.push(bus.retain());

		return () => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		};
	}, [enabled, activeHostUrl, groupId, rootId]);
}
