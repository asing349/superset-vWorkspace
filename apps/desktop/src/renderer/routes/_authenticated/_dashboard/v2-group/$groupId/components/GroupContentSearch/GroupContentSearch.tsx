import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CommandPrimitive } from "@superset/ui/command";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type GroupContentSearchResult,
	useGroupContentSearch,
} from "../../hooks/useGroupContentSearch";
import { GroupContentResultItem } from "./components/GroupContentResultItem";

// 48px input + 10 * 40px items, mirrors the single-workspace CommandPalette.
const MAX_DIALOG_HEIGHT = 448;

export interface GroupContentSearchProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Open the selected content match's file from the correct root. The result
	 * carries the `rootId` (for `{ groupId, rootId }` FS routing) and the `line`
	 * of the match; the group shell threads it into
	 * `useGroupFileNavigation.openFilePane`.
	 */
	onSelectResult: (result: GroupContentSearchResult) => void;
}

/**
 * Multi-root workspace ("group") cross-root CONTENT search overlay (Q4 / M8).
 *
 * The content-search sibling of `GroupQuickOpen` (which searches file *names*).
 * It reuses the same overlay plumbing — a centered Radix dialog wrapping a cmdk
 * `CommandPrimitive` with a search input and a flat, keyboard-navigable result
 * list — but the source is `useGroupContentSearch`, which fans out
 * `filesystem.searchContent` to every existing root and merges the results. Each
 * result is a matched LINE (not a file), grouped under a per-file header and
 * labelled with its owning root. Selecting a match calls `onSelectResult` with
 * the full result (including `rootId` + `line`) so the shell can open the file
 * from the right root.
 */
export function GroupContentSearch({
	open,
	onOpenChange,
	onSelectResult,
}: GroupContentSearchProps) {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const { fileGroups, totalMatches, isFetching } = useGroupContentSearch(
		open ? query : "",
	);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
			if (!nextOpen) setQuery("");
		},
		[onOpenChange],
	);

	const handleSelectResult = useCallback(
		(result: GroupContentSearchResult) => {
			onSelectResult(result);
			handleOpenChange(false);
		},
		[onSelectResult, handleOpenChange],
	);

	useEffect(() => {
		if (open) requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	const trimmedQuery = query.trim();
	const showEmptyState =
		trimmedQuery.length > 0 && !isFetching && totalMatches === 0;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50" />
				<DialogPrimitive.Content
					className="fixed left-[50%] z-50 w-full max-w-[672px] translate-x-[-50%] overflow-hidden rounded-lg border shadow-lg"
					style={{ top: `calc(50% - ${MAX_DIALOG_HEIGHT / 2}px)` }}
				>
					<DialogPrimitive.Title className="sr-only">
						Search in Files (all roots)
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						Search file contents across every root of this multi-root workspace
					</DialogPrimitive.Description>

					<CommandPrimitive
						shouldFilter={false}
						className="bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md"
					>
						<div className="flex h-12 items-center gap-2 border-b px-3">
							<SearchIcon className="size-5 shrink-0 opacity-50" />
							<CommandPrimitive.Input
								ref={inputRef}
								placeholder="Search in files across all roots..."
								value={query}
								onValueChange={setQuery}
								className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
							/>
						</div>

						<CommandPrimitive.List className="max-h-[400px] overflow-x-hidden overflow-y-auto scroll-py-1 p-1">
							{showEmptyState && (
								<CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
									No matches found.
								</CommandPrimitive.Empty>
							)}

							{fileGroups.map((group) => (
								<CommandPrimitive.Group
									key={group.id}
									heading={
										<span className="flex items-center gap-1.5">
											<span className="truncate">{group.relativePath}</span>
											<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
												{group.rootLabel}
											</span>
										</span>
									}
									className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs"
								>
									{group.matches.map((match) => (
										<GroupContentResultItem
											key={match.id}
											value={match.id}
											fileName={match.name}
											relativePath={match.relativePath}
											rootLabel={match.rootLabel}
											line={match.line}
											column={match.column}
											preview={match.preview}
											onSelect={() => handleSelectResult(match)}
										/>
									))}
								</CommandPrimitive.Group>
							))}
						</CommandPrimitive.List>
					</CommandPrimitive>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
