import { asc, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaceGroupRoots, workspaceGroups } from "../../db/schema.ts";
import type { WorkspaceGroupRootInput, WorkspaceGroupStore } from "./store.ts";
import type {
	WorkspaceGroup,
	WorkspaceGroupRoot,
	WorkspaceGroupRootKind,
} from "./types.ts";

/** A `workspace_group_roots` row as Drizzle returns it (db column → field). */
interface RootRow {
	id: string;
	groupId: string;
	kind: string;
	workspaceId: string | null;
	folderPath: string | null;
	label: string;
	position: number;
}

interface GroupRow {
	id: string;
	name: string;
	defaultRootId: string | null;
	createdAt: number;
}

function rowToRoot(row: RootRow): WorkspaceGroupRoot {
	return {
		rootId: row.id,
		// `kind` is a free-text column at the SQL layer; the store only ever
		// writes the two valid values, so narrowing on read is safe.
		kind: row.kind as WorkspaceGroupRootKind,
		workspaceId: row.workspaceId,
		folderPath: row.folderPath,
		label: row.label,
		position: row.position,
	};
}

function buildGroup(group: GroupRow, rootRows: RootRow[]): WorkspaceGroup {
	return {
		id: group.id,
		name: group.name,
		defaultRootId: group.defaultRootId,
		// Trust the stored `position` ordering (the query already sorts by it),
		// but re-stamp to the array index so positions are always 0..n-1 even if
		// an out-of-band write left a gap.
		roots: rootRows.map((row, index) => ({
			...rowToRoot(row),
			position: index,
		})),
		createdAt: group.createdAt,
	};
}

function makeRootRow(input: {
	groupId: string;
	root: WorkspaceGroupRootInput;
	position: number;
}): RootRow {
	return {
		id: crypto.randomUUID(),
		groupId: input.groupId,
		kind: input.root.kind,
		workspaceId: input.root.workspaceId,
		folderPath: input.root.folderPath,
		label: input.root.label,
		position: input.position,
	};
}

/**
 * SQLite-backed `WorkspaceGroupStore` (M7). Persists groups across host
 * restarts in the host-local `workspace_groups` / `workspace_group_roots`
 * tables. Behaviorally identical to `createInMemoryWorkspaceGroupStore`:
 * `rootId` via `crypto.randomUUID()`, `position` kept equal to the array index
 * (re-stamped on every mutation), `setDefaultRoot` validates membership,
 * `removeRoot` clears a dangling default, and every method returns a plain
 * `WorkspaceGroup` with roots in `position` order.
 */
export function createSqliteWorkspaceGroupStore(
	db: HostDb,
): WorkspaceGroupStore {
	function readRootRows(groupId: string): RootRow[] {
		return db
			.select()
			.from(workspaceGroupRoots)
			.where(eq(workspaceGroupRoots.groupId, groupId))
			.orderBy(asc(workspaceGroupRoots.position))
			.all();
	}

	function readGroupRow(id: string): GroupRow | undefined {
		return db.query.workspaceGroups
			.findFirst({ where: eq(workspaceGroups.id, id) })
			.sync();
	}

	function loadGroup(id: string): WorkspaceGroup | null {
		const group = readGroupRow(id);
		if (!group) {
			return null;
		}
		return buildGroup(group, readRootRows(id));
	}

	function requireGroup(id: string): WorkspaceGroup {
		const group = loadGroup(id);
		if (!group) {
			throw new Error(`Workspace group not found: ${id}`);
		}
		return group;
	}

	return {
		create({ name, roots }) {
			const id = crypto.randomUUID();
			const createdAt = Date.now();
			db.transaction((tx) => {
				tx.insert(workspaceGroups)
					.values({ id, name, defaultRootId: null, createdAt })
					.run();
				const rows = roots.map((root, index) =>
					makeRootRow({ groupId: id, root, position: index }),
				);
				if (rows.length > 0) {
					tx.insert(workspaceGroupRoots).values(rows).run();
				}
			});
			return requireGroup(id);
		},

		get(id) {
			return loadGroup(id);
		},

		list() {
			const groupRows = db
				.select()
				.from(workspaceGroups)
				.orderBy(asc(workspaceGroups.createdAt))
				.all();
			return groupRows.map((group) =>
				buildGroup(group, readRootRows(group.id)),
			);
		},

		rename({ id, name }) {
			// Ensure the group exists so callers get the same not-found error as
			// the in-memory store rather than a silent no-op update.
			requireGroup(id);
			db.update(workspaceGroups)
				.set({ name })
				.where(eq(workspaceGroups.id, id))
				.run();
			return requireGroup(id);
		},

		addRoot({ id, root }) {
			const group = requireGroup(id);
			db.insert(workspaceGroupRoots)
				.values(
					makeRootRow({ groupId: id, root, position: group.roots.length }),
				)
				.run();
			return requireGroup(id);
		},

		removeRoot({ id, rootId }) {
			const group = requireGroup(id);
			db.transaction((tx) => {
				tx.delete(workspaceGroupRoots)
					.where(eq(workspaceGroupRoots.id, rootId))
					.run();
				// Re-stamp positions to the new array order, mirroring the
				// in-memory store's `withNormalizedPositions`.
				const remaining = group.roots.filter((r) => r.rootId !== rootId);
				remaining.forEach((r, index) => {
					tx.update(workspaceGroupRoots)
						.set({ position: index })
						.where(eq(workspaceGroupRoots.id, r.rootId))
						.run();
				});
				// Drop a dangling default pointer when its target was removed.
				if (group.defaultRootId === rootId) {
					tx.update(workspaceGroups)
						.set({ defaultRootId: null })
						.where(eq(workspaceGroups.id, id))
						.run();
				}
			});
			return requireGroup(id);
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
			db.transaction((tx) => {
				ordered.forEach((root, index) => {
					tx.update(workspaceGroupRoots)
						.set({ position: index })
						.where(eq(workspaceGroupRoots.id, root.rootId))
						.run();
				});
			});
			return requireGroup(id);
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
			db.update(workspaceGroups)
				.set({ defaultRootId: rootId })
				.where(eq(workspaceGroups.id, id))
				.run();
			return requireGroup(id);
		},

		delete(id) {
			// `workspace_group_roots.group_id` cascades on delete, so removing the
			// group row removes its roots too.
			db.delete(workspaceGroups).where(eq(workspaceGroups.id, id)).run();
		},
	};
}
