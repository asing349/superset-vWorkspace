import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";
import { GroupFileTreeSection } from "./components/GroupFileTreeSection";
import { GroupUnavailableRootSection } from "./components/GroupUnavailableRootSection";

interface GroupFilesTabProps {
	selectedFilePath?: string;
	/**
	 * Open a file from a specific root. The `rootId` threads `{ groupId, rootId }`
	 * filesystem routing through the pane registry (M2 seam); the caller wires
	 * this to `useGroupFileNavigation.openFilePane`.
	 */
	onSelectFile: (input: {
		rootId: string;
		filePath: string;
		openInNewTab?: boolean;
	}) => void;
}

/**
 * Multi-root Files explorer (M4): one collapsible section per resolved root,
 * each an independent `useFileTree` instance (Q2 default — N independent trees).
 *
 * Addressing per section is chosen by the root's `kind` inside
 * `GroupFileTreeSection`: `kind: "workspace"` → `{ workspaceId }`,
 * `kind: "folder"` → `{ groupId, rootId }`. Roots that don't currently exist on
 * disk render as unavailable instead of crashing the explorer. File clicks call
 * `onSelectFile` with the clicked section's `rootId`, so the group shell opens
 * the file into the shared editor against the correct root.
 */
export function GroupFilesTab({
	selectedFilePath,
	onSelectFile,
}: GroupFilesTabProps) {
	const { groupId, roots } = useWorkspaceGroup();

	if (roots.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground select-text">
				This multi-root workspace has no roots yet.
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{roots.map((root) =>
				root.exists ? (
					<GroupFileTreeSection
						key={root.rootId}
						groupId={groupId}
						root={root}
						// VS Code expands the first root by default; collapse the rest so
						// large multi-root workspaces don't fan out every tree at once.
						defaultOpen={root.position === 0}
						selectedFilePath={selectedFilePath}
						onSelectFile={({ rootId, absolutePath, openInNewTab }) =>
							onSelectFile({
								rootId,
								filePath: absolutePath,
								openInNewTab,
							})
						}
					/>
				) : (
					<GroupUnavailableRootSection key={root.rootId} root={root} />
				),
			)}
		</div>
	);
}
