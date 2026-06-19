import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CommandPrimitive } from "@superset/ui/command";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type GroupFileSearchResult,
	useGroupFileSearch,
} from "../../hooks/useGroupFileSearch";
import { GroupFileResultItem } from "./components/GroupFileResultItem";

// 48px input + 10 * 40px items, mirrors the single-workspace CommandPalette.
const MAX_DIALOG_HEIGHT = 448;

export interface GroupQuickOpenProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Open the selected file from the correct root. The result carries the
	 * `rootId`, which the group shell threads into
	 * `useGroupFileNavigation.openFilePane` so the file is read from THAT root's
	 * FS service.
	 */
	onSelectResult: (result: GroupFileSearchResult) => void;
}

/**
 * Multi-root workspace ("group") quick-open overlay (Q4: fan-out-and-merge).
 *
 * Mirrors the single-workspace quick-open UX (`CommandPalette` `variant="v2"`):
 * a centered Radix dialog wrapping a cmdk `CommandPrimitive` with a search
 * input and a flat result list. The difference is the source: results come from
 * `useGroupFileSearch`, which fans out a `searchFiles` call to every existing
 * root and merges them, and each row is labelled with its owning root. Selecting
 * a result calls `onSelectResult` with the full result (including `rootId`) so
 * the shell can open it from the right root.
 */
export function GroupQuickOpen({
	open,
	onOpenChange,
	onSelectResult,
}: GroupQuickOpenProps) {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const { results } = useGroupFileSearch(open ? query : "");

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
			if (!nextOpen) setQuery("");
		},
		[onOpenChange],
	);

	const handleSelectResult = useCallback(
		(result: GroupFileSearchResult) => {
			onSelectResult(result);
			handleOpenChange(false);
		},
		[onSelectResult, handleOpenChange],
	);

	useEffect(() => {
		if (open) requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	const showEmptyState = query.trim().length > 0 && results.length === 0;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50" />
				<DialogPrimitive.Content
					className="fixed left-[50%] z-50 w-full max-w-[672px] translate-x-[-50%] overflow-hidden rounded-lg border shadow-lg"
					style={{ top: `calc(50% - ${MAX_DIALOG_HEIGHT / 2}px)` }}
				>
					<DialogPrimitive.Title className="sr-only">
						Quick Open (all roots)
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						Search for files across every root of this multi-root workspace
					</DialogPrimitive.Description>

					<CommandPrimitive
						shouldFilter={false}
						className="bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md"
					>
						<div className="flex h-12 items-center gap-2 border-b px-3">
							<SearchIcon className="size-5 shrink-0 opacity-50" />
							<CommandPrimitive.Input
								ref={inputRef}
								placeholder="Search files across all roots..."
								value={query}
								onValueChange={setQuery}
								className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
							/>
						</div>

						<CommandPrimitive.List className="max-h-[400px] overflow-x-hidden overflow-y-auto scroll-py-1 p-1">
							{showEmptyState && (
								<CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
									No files found.
								</CommandPrimitive.Empty>
							)}

							{results.map((result) => (
								<GroupFileResultItem
									key={result.id}
									value={result.id}
									fileName={result.name}
									relativePath={result.relativePath}
									rootLabel={result.rootLabel}
									onSelect={() => handleSelectResult(result)}
								/>
							))}
						</CommandPrimitive.List>
					</CommandPrimitive>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
