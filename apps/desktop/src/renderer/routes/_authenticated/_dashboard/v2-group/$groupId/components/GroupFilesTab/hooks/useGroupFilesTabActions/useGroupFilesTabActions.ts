import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import type { ResolvedGroupRoot } from "../../../../providers/WorkspaceGroupProvider";
import {
	getNameFromPath,
	getParentDirectory,
	isValidEntryName,
	joinPath,
} from "../../utils/groupTreePaths";

/**
 * The filesystem addressing for a group root's write mutations, mirroring the
 * host `addressingSchema` union (`{ workspaceId } | { groupId, rootId }`). A
 * `kind: "workspace"` root carries a real `workspaceId`; every other resolvable
 * root (folder roots, and workspace roots missing their id) addresses by
 * `{ groupId, rootId }` — wave-2 M1 made all five FS write procs accept either.
 */
type GroupWriteAddressing =
	| { workspaceId: string }
	| { groupId: string; rootId: string };

export interface GroupFilesTabActions {
	/** Create an empty file `name` inside `parentAbsolutePath`. */
	createFile(input: {
		parentAbsolutePath: string;
		name: string;
	}): Promise<void>;
	/** Create a directory `name` inside `parentAbsolutePath`. */
	createFolder(input: {
		parentAbsolutePath: string;
		name: string;
	}): Promise<void>;
	/** Rename/move `absolutePath` to `name` within its own parent directory. */
	rename(input: { absolutePath: string; name: string }): Promise<void>;
	/** Permanently delete `absolutePath` (callers confirm first). */
	deleteEntry(input: {
		absolutePath: string;
		isDirectory: boolean;
	}): Promise<void>;
}

/**
 * Filesystem-mutating actions for ONE root of the multi-root ("group") file
 * explorer — the group analogue of the single-workspace `useFilesTabActions`.
 *
 * Unlike the single-workspace hook (which drives a Pierre tree via a bridge),
 * the group explorer renders a plain recursive tree off `useFileTree` and works
 * in absolute paths, so this hook only owns the tRPC write mutations + their
 * addressing; the inline create/rename UI and confirm dialog live in the
 * components. Tree refresh is NOT issued manually here: the host emits
 * `fs:events` (workspace roots) / `fs:groupEvents` (folder roots) for every
 * mutation, which `useFileTree` already subscribes to and reconciles live.
 *
 * Addressing follows the root's `kind` (wave-2 M1 host contract):
 * - `kind: "workspace"` → `{ workspaceId }`.
 * - everything else resolvable → `{ groupId, rootId }`.
 */
export function useGroupFilesTabActions({
	groupId,
	root,
}: {
	groupId: string;
	root: ResolvedGroupRoot;
}): GroupFilesTabActions {
	const writeFile = workspaceTrpc.filesystem.writeFile.useMutation();
	const createDirectory =
		workspaceTrpc.filesystem.createDirectory.useMutation();
	const movePath = workspaceTrpc.filesystem.movePath.useMutation();
	const deletePath = workspaceTrpc.filesystem.deletePath.useMutation();

	const addressing = useMemo<GroupWriteAddressing>(
		() =>
			root.kind === "workspace" && root.workspaceId
				? { workspaceId: root.workspaceId }
				: { groupId, rootId: root.rootId },
		[groupId, root.kind, root.rootId, root.workspaceId],
	);

	const createFile = useCallback(
		async ({
			parentAbsolutePath,
			name,
		}: {
			parentAbsolutePath: string;
			name: string;
		}): Promise<void> => {
			if (!isValidEntryName(name)) return;
			const absolutePath = joinPath(parentAbsolutePath, name.trim());
			try {
				await writeFile.mutateAsync({
					...addressing,
					absolutePath,
					content: "",
					options: { create: true, overwrite: false },
				});
			} catch (error) {
				toast.error("Failed to create file", {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		},
		[addressing, writeFile],
	);

	const createFolder = useCallback(
		async ({
			parentAbsolutePath,
			name,
		}: {
			parentAbsolutePath: string;
			name: string;
		}): Promise<void> => {
			if (!isValidEntryName(name)) return;
			const absolutePath = joinPath(parentAbsolutePath, name.trim());
			try {
				await createDirectory.mutateAsync({
					...addressing,
					absolutePath,
					recursive: true,
				});
			} catch (error) {
				toast.error("Failed to create folder", {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		},
		[addressing, createDirectory],
	);

	const rename = useCallback(
		async ({
			absolutePath,
			name,
		}: {
			absolutePath: string;
			name: string;
		}): Promise<void> => {
			if (!isValidEntryName(name)) return;
			const trimmed = name.trim();
			if (trimmed === getNameFromPath(absolutePath)) return;
			const destinationAbsolutePath = joinPath(
				getParentDirectory(absolutePath),
				trimmed,
			);
			try {
				await movePath.mutateAsync({
					...addressing,
					sourceAbsolutePath: absolutePath,
					destinationAbsolutePath,
				});
			} catch (error) {
				toast.error("Failed to rename", {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		},
		[addressing, movePath],
	);

	const deleteEntry = useCallback(
		async ({
			absolutePath,
		}: {
			absolutePath: string;
			isDirectory: boolean;
		}): Promise<void> => {
			const name = getNameFromPath(absolutePath);
			try {
				await deletePath.mutateAsync({ ...addressing, absolutePath });
			} catch (error) {
				toast.error(`Failed to delete ${name}`, {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		},
		[addressing, deletePath],
	);

	return { createFile, createFolder, rename, deleteEntry };
}
