import { useWorkspaceClient } from "@superset/workspace-client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	acquireDocument,
	documentAddressingKey,
	type FileDocumentGroupAddressing,
	releaseDocument,
} from "./fileDocumentStore";
import type { SharedFileDocument } from "./types";

interface UseSharedFileDocumentParams {
	workspaceId: string;
	absolutePath: string;
	/**
	 * Optional multi-root workspace ("group") addressing. When provided, file
	 * reads route to the root's FS service via `{ groupId, rootId }`. When
	 * omitted (single-workspace shell), reads use `{ workspaceId }` unchanged.
	 */
	groupAddressing?: FileDocumentGroupAddressing | null;
}

export function useSharedFileDocument({
	workspaceId,
	absolutePath,
	groupAddressing = null,
}: UseSharedFileDocumentParams): SharedFileDocument {
	const { trpcClient } = useWorkspaceClient();

	// Stable string discriminator for the document's addressing identity, derived
	// from the SAME `groupAddressing ?? { workspaceId }` choice the cache key,
	// `readAddressing`, and `writeAddressing` make. The `groupAddressing` object
	// is rebuilt inline on every render by the pane (`{ groupId, rootId }`), so it
	// is referentially unstable; this primitive changes value ONLY when the
	// addressing identity actually changes (group↔workspace, or a different
	// group/root), which makes it a safe effect dependency and swap trigger.
	const addressingKey = documentAddressingKey(workspaceId, groupAddressing);

	// The release cleanup must call `releaseDocument` with the SAME addressing the
	// matching `acquireDocument` used, or it would look up a different cache key
	// and leak the lease. The ref carries the live (unstable) `groupAddressing`
	// object so the cleanup can pass it without re-running on every render.
	const groupAddressingRef = useRef(groupAddressing);
	groupAddressingRef.current = groupAddressing;

	const [state, setState] = useState<{
		handle: SharedFileDocument;
		workspaceId: string;
		absolutePath: string;
		addressingKey: string;
	}>(() => ({
		handle: acquireDocument(
			workspaceId,
			absolutePath,
			trpcClient,
			groupAddressing,
		),
		workspaceId,
		absolutePath,
		addressingKey,
	}));

	// Swap handles synchronously when the pane is retargeted at a different file
	// (e.g. a preview pane reassigned from env.ts to bun.lock) OR at the same file
	// under a different addressing identity (single-workspace ↔ group / a different
	// root) — both are distinct cache entries, so the old handle must be released
	// and a new one acquired. setState during render restarts the render before
	// commit so consumers never observe a handle pointing at the previous entry.
	if (
		state.workspaceId !== workspaceId ||
		state.absolutePath !== absolutePath ||
		state.addressingKey !== addressingKey
	) {
		// Rename case: the entry behind our existing handle was migrated to
		// match the new props. Reuse the handle — acquiring again would bump
		// refCount a second time and release() of the old key no-ops (the
		// entry isn't at that key anymore), which would leak one lease per
		// rename.
		const handleAlreadyPointsAtNewPath =
			state.handle.workspaceId === workspaceId &&
			state.handle.absolutePath === absolutePath &&
			state.addressingKey === addressingKey;
		const handle = handleAlreadyPointsAtNewPath
			? state.handle
			: acquireDocument(workspaceId, absolutePath, trpcClient, groupAddressing);
		setState({ handle, workspaceId, absolutePath, addressingKey });
	}

	useEffect(() => {
		// Snapshot the addressing for THIS lease at effect-setup. The effect's
		// deps include `addressingKey`, so it re-runs (releasing the prior lease)
		// whenever the addressing identity changes for the same path — binding the
		// release to the addressing the matching `acquireDocument` actually used.
		// Referencing `addressingKey` here also makes it a genuine dependency.
		void addressingKey;
		const leasedAddressing = groupAddressingRef.current;
		return () => {
			// Release MUST key the document cache by the same addressing the
			// matching acquireDocument used (group/folder roots key by
			// `group:${groupId}:${rootId}`, single-workspace/workspace roots by
			// `ws:${workspaceId}`). `leasedAddressing` is the snapshot for this
			// lease, keeping the ref-counting acquire/release pair balanced —
			// releasing with the wrong addressing would look up a different cache
			// key and leak the lease.
			releaseDocument(workspaceId, absolutePath, leasedAddressing);
		};
	}, [workspaceId, absolutePath, addressingKey]);

	useSyncExternalStore(
		state.handle.subscribe,
		state.handle.getVersion,
		state.handle.getVersion,
	);

	return state.handle;
}
