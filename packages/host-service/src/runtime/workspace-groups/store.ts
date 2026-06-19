import type { WorkspaceGroup, WorkspaceGroupRoot } from "./types.ts";

/**
 * Input shape for a not-yet-stored root: the caller supplies everything
 * except the store-assigned `rootId` and `position`.
 */
export type WorkspaceGroupRootInput = Omit<
	WorkspaceGroupRoot,
	"rootId" | "position"
>;

/**
 * Storage seam for multi-root workspaces. The router and UI depend only on
 * this interface so the backend can swap from the in-memory implementation to
 * a SQLite-backed one (M7) without any contract change.
 */
export interface WorkspaceGroupStore {
	create(input: {
		name: string;
		roots: WorkspaceGroupRootInput[];
	}): WorkspaceGroup;
	get(id: string): WorkspaceGroup | null;
	list(): WorkspaceGroup[];
	rename(input: { id: string; name: string }): WorkspaceGroup;
	addRoot(input: { id: string; root: WorkspaceGroupRootInput }): WorkspaceGroup;
	removeRoot(input: { id: string; rootId: string }): WorkspaceGroup;
	reorderRoots(input: { id: string; orderedRootIds: string[] }): WorkspaceGroup;
	setDefaultRoot(input: { id: string; rootId: string | null }): WorkspaceGroup;
	delete(id: string): void;
}

/**
 * Re-stamp `position` to match array order. The store keeps roots in a plain
 * array and treats the array index as the canonical ordering, so every
 * mutation that changes the array re-normalizes positions through here.
 */
function withNormalizedPositions(
	roots: WorkspaceGroupRoot[],
): WorkspaceGroupRoot[] {
	return roots.map((root, index) => ({ ...root, position: index }));
}

function makeRoot(input: WorkspaceGroupRootInput): WorkspaceGroupRoot {
	return {
		rootId: crypto.randomUUID(),
		kind: input.kind,
		workspaceId: input.workspaceId,
		folderPath: input.folderPath,
		label: input.label,
		// Overwritten by withNormalizedPositions once placed in the array.
		position: 0,
	};
}

/** Deep-ish clone so callers can't mutate stored state through a returned ref. */
function cloneGroup(group: WorkspaceGroup): WorkspaceGroup {
	return {
		...group,
		roots: group.roots.map((root) => ({ ...root })),
	};
}

/**
 * In-memory `WorkspaceGroupStore`. Holds groups in a `Map<id, WorkspaceGroup>`;
 * state is lost on host restart (acceptable until M7 swaps in SQLite). Assigns
 * `rootId` via `crypto.randomUUID()` and keeps `position` equal to the array
 * index.
 */
export function createInMemoryWorkspaceGroupStore(): WorkspaceGroupStore {
	const groups = new Map<string, WorkspaceGroup>();

	function requireGroup(id: string): WorkspaceGroup {
		const group = groups.get(id);
		if (!group) {
			throw new Error(`Workspace group not found: ${id}`);
		}
		return group;
	}

	return {
		create({ name, roots }) {
			const id = crypto.randomUUID();
			const group: WorkspaceGroup = {
				id,
				name,
				defaultRootId: null,
				roots: withNormalizedPositions(roots.map(makeRoot)),
				createdAt: Date.now(),
			};
			groups.set(id, group);
			return cloneGroup(group);
		},

		get(id) {
			const group = groups.get(id);
			return group ? cloneGroup(group) : null;
		},

		list() {
			return Array.from(groups.values()).map(cloneGroup);
		},

		rename({ id, name }) {
			const group = requireGroup(id);
			group.name = name;
			return cloneGroup(group);
		},

		addRoot({ id, root }) {
			const group = requireGroup(id);
			group.roots = withNormalizedPositions([...group.roots, makeRoot(root)]);
			return cloneGroup(group);
		},

		removeRoot({ id, rootId }) {
			const group = requireGroup(id);
			group.roots = withNormalizedPositions(
				group.roots.filter((root) => root.rootId !== rootId),
			);
			// Drop a dangling default pointer when its target was removed.
			if (group.defaultRootId === rootId) {
				group.defaultRootId = null;
			}
			return cloneGroup(group);
		},

		reorderRoots({ id, orderedRootIds }) {
			const group = requireGroup(id);
			const byId = new Map(group.roots.map((root) => [root.rootId, root]));
			const ordered: WorkspaceGroupRoot[] = [];
			for (const rootId of orderedRootIds) {
				const root = byId.get(rootId);
				if (!root) {
					throw new Error(
						`Cannot reorder: root ${rootId} is not in group ${id}`,
					);
				}
				byId.delete(rootId);
				ordered.push(root);
			}
			if (byId.size > 0) {
				throw new Error(
					`Cannot reorder: orderedRootIds omits ${byId.size} root(s) of group ${id}`,
				);
			}
			group.roots = withNormalizedPositions(ordered);
			return cloneGroup(group);
		},

		setDefaultRoot({ id, rootId }) {
			const group = requireGroup(id);
			if (
				rootId !== null &&
				!group.roots.some((root) => root.rootId === rootId)
			) {
				throw new Error(
					`Cannot set default: root ${rootId} is not in group ${id}`,
				);
			}
			group.defaultRootId = rootId;
			return cloneGroup(group);
		},

		delete(id) {
			groups.delete(id);
		},
	};
}
