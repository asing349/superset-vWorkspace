import { useCallback } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

export interface SelectedFolderRoot {
	folderPath: string;
}

/**
 * Opens the native folder picker and returns the chosen absolute path, or null
 * if the user cancelled.
 *
 * This reuses the SAME mechanism the existing folder-first import uses
 * (`useFolderFirstImport` → `electronTrpc.window.selectDirectory`): the picker
 * runs in the Electron MAIN process over IPC. The renderer never touches Node
 * (`fs`/`path`/`dialog`) directly — it only calls the typed IPC mutation and
 * receives `{ canceled, path }`.
 */
export function useSelectFolderRoot(): {
	selectFolder: () => Promise<SelectedFolderRoot | null>;
} {
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();

	const selectFolder =
		useCallback(async (): Promise<SelectedFolderRoot | null> => {
			const picked = await selectDirectory.mutateAsync({
				title: "Add folder to multi-root workspace",
			});
			if (picked.canceled || !picked.path) return null;
			return { folderPath: picked.path };
		}, [selectDirectory]);

	return { selectFolder };
}
