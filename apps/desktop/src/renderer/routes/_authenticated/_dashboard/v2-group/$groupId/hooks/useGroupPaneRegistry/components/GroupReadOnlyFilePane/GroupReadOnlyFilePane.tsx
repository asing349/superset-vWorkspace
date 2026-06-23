import { LuLock } from "react-icons/lu";
import {
	type FileDocumentGroupAddressing,
	useSharedFileDocument,
} from "../../../../../../v2-workspace/$workspaceId/state/fileDocumentStore";

/**
 * Read-only file viewer for a group root that has no writable target.
 *
 * Since wave-2 M1 (host FS write procs accept `{ groupId, rootId }`) and wave-3
 * A1 (group-explorer mutations), every root that RESOLVES on disk — workspace
 * AND folder — is editable through `FilePane`. This pane is now used only for
 * roots that do NOT resolve (`exists: false`, e.g. a deleted worktree) or an
 * unknown/unmatched `rootId`: there is simply no FS service to write through.
 * Reads still route via `{ groupId, rootId }` (group addressing) so any cached
 * content can be displayed, but the root is surfaced as unavailable.
 */
export function GroupReadOnlyFilePane({
	filePath,
	workspaceId,
	groupAddressing,
}: {
	filePath: string;
	workspaceId: string;
	groupAddressing: FileDocumentGroupAddressing | null;
}) {
	const document = useSharedFileDocument({
		workspaceId,
		absolutePath: filePath,
		groupAddressing,
	});

	const body = (() => {
		if (document.content.kind === "loading") {
			return (
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
					Loading…
				</div>
			);
		}
		if (document.content.kind === "text") {
			return (
				<pre className="h-full overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground select-text">
					{document.content.value}
				</pre>
			);
		}
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground select-text cursor-text">
				This file can't be displayed.
			</div>
		);
	})();

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground select-text">
				<LuLock className="size-3" />
				Read-only — this root is currently unavailable
			</div>
			<div className="min-h-0 min-w-0 flex-1">{body}</div>
		</div>
	);
}
