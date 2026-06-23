import { cn } from "@superset/ui/utils";
import { useEffect, useRef, useState } from "react";

const ROW_HEIGHT = 24;
const INDENT_PER_LEVEL = 12;

interface GroupTreeInlineInputProps {
	/** Initial value placed in the input (a default name, or the current name). */
	initialValue: string;
	/** Nesting level, so the input aligns with the row it replaces/precedes. */
	level: number;
	/** Optional leading icon (file/folder), matching the row chrome. */
	icon?: React.ReactNode;
	/** Commit the typed name. No-op for an empty/unchanged value is the caller's job. */
	onCommit: (name: string) => void;
	/** Abandon the edit (Escape or blur without a commit). */
	onCancel: () => void;
}

/**
 * Inline text input for the group explorer's create/rename flow — the group
 * analogue of Pierre's `startRenaming`, which the group's plain `useFileTree`
 * (non-Pierre) doesn't provide. Commits on Enter or blur, cancels on Escape.
 * For a rename, the basename (sans extension) is preselected, mirroring VS Code.
 */
export function GroupTreeInlineInput({
	initialValue,
	level,
	icon,
	onCommit,
	onCancel,
}: GroupTreeInlineInputProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [value, setValue] = useState(initialValue);
	// Guard against the blur handler firing after Enter/Escape already settled
	// the edit (commit + blur would otherwise double-fire).
	const settledRef = useRef(false);

	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		const dotIndex = initialValue.lastIndexOf(".");
		if (dotIndex > 0) {
			input.setSelectionRange(0, dotIndex);
		} else {
			input.select();
		}
	}, [initialValue]);

	const commit = () => {
		if (settledRef.current) return;
		settledRef.current = true;
		onCommit(value);
	};

	const cancel = () => {
		if (settledRef.current) return;
		settledRef.current = true;
		onCancel();
	};

	return (
		<div
			className="flex w-full items-center gap-1 pr-2"
			style={{ height: ROW_HEIGHT, paddingLeft: 4 + level * INDENT_PER_LEVEL }}
		>
			<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
				{icon}
			</span>
			<input
				ref={inputRef}
				value={value}
				spellCheck={false}
				autoComplete="off"
				className={cn(
					"min-w-0 flex-1 rounded-sm border border-primary/60 bg-background px-1 text-[13px] text-foreground outline-none",
				)}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						cancel();
					}
				}}
				onBlur={commit}
			/>
		</div>
	);
}
