/**
 * Inline-edit state for one group-explorer root section (A1). At most one edit
 * (a create placeholder OR an in-place rename) is active per root at a time.
 */
export type GroupTreeEditingState =
	| {
			kind: "create";
			/** Absolute directory the new entry is created in. */
			parentAbsolutePath: string;
			mode: "file" | "folder";
			/** Pre-filled default name for the placeholder input. */
			defaultName: string;
	  }
	| {
			kind: "rename";
			/** Absolute path of the entry being renamed. */
			absolutePath: string;
	  };

/** Handlers a row needs to start an edit from its context menu. */
export interface GroupTreeRowMenuHandlers {
	onNewFile: (parentAbsolutePath: string) => void;
	onNewFolder: (parentAbsolutePath: string) => void;
	onStartRename: (absolutePath: string) => void;
	onDelete: (input: { absolutePath: string; isDirectory: boolean }) => void;
}
