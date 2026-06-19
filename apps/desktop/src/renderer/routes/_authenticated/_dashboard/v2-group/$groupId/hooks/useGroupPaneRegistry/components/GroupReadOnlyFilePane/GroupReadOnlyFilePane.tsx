import { LuLock } from "react-icons/lu";
import {
	type FileDocumentGroupAddressing,
	useSharedFileDocument,
} from "../../../../../../v2-workspace/$workspaceId/state/fileDocumentStore";

/**
 * Read-only file viewer for a `kind: "folder"` group root.
 *
 * Folder-root writes are not supported by the host contract today (the
 * `filesystem.writeFile` mutation is `workspaceId`-addressed and folder roots
 * have no `workspaceId`), so folder-root files are surfaced read-only here
 * instead of through the editable `FilePane` save path. Reads still route via
 * `{ groupId, rootId }` (group addressing), so the content loads through the
 * correct root's FS service. When the host gains a folder-root write path, this
 * can be replaced by the editable `FilePane`.
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
				Read-only — folder roots can't be edited yet
			</div>
			<div className="min-h-0 min-w-0 flex-1">{body}</div>
		</div>
	);
}
