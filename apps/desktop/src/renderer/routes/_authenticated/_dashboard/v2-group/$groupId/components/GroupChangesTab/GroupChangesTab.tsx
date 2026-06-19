import { useMemo } from "react";
import { useWorkspaceGroup } from "../../providers/WorkspaceGroupProvider";
import { GroupChangesSection } from "./components/GroupChangesSection";

interface GroupChangesTabProps {
	selectedFilePath?: string;
	/** Open a changed file from a specific root (threads `rootId` for FS routing). */
	onSelectFile: (input: {
		rootId: string;
		filePath: string;
		openInNewTab?: boolean;
	}) => void;
}

/**
 * Multi-root Changes tab (M4): one collapsible git section per root that is a
 * git repository.
 *
 * Per the M2 discoveries, git status is `workspaceId`-keyed, so only
 * `kind: "workspace"` roots (which carry a real `workspaceId`) are git repos
 * here; `kind: "folder"` roots are skipped entirely. Each section reuses the
 * existing single-worktree `useGitStatus` query for its root's `workspaceId`.
 */
export function GroupChangesTab({
	selectedFilePath,
	onSelectFile,
}: GroupChangesTabProps) {
	const { roots } = useWorkspaceGroup();

	const gitRoots = useMemo(
		() =>
			roots.filter(
				(root) => root.kind === "workspace" && root.workspaceId && root.exists,
			),
		[roots],
	);

	if (gitRoots.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground select-text">
				No git repositories in this multi-root workspace.
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{gitRoots.map((root, index) => (
				<GroupChangesSection
					key={root.rootId}
					root={root}
					// `workspaceId` is non-null for git roots (filtered above); assert it
					// so the section receives a plain string.
					workspaceId={root.workspaceId ?? ""}
					defaultOpen={index === 0}
					selectedFilePath={selectedFilePath}
					onSelectFile={({ rootId, absolutePath, openInNewTab }) =>
						onSelectFile({ rootId, filePath: absolutePath, openInNewTab })
					}
				/>
			))}
		</div>
	);
}
