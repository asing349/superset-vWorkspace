import { useEffect, useRef } from "react";
import { detectLanguage } from "shared/detect-language";
import type { ViewProps } from "../../types";
import { CodeEditor, type CodeEditorAdapter } from "./components/CodeEditor";

export function CodeView({
	document,
	filePath,
	focusLine,
	focusColumn,
	focusTick,
}: ViewProps) {
	const editorRef = useRef<CodeEditorAdapter | null>(null);

	// A3: scroll to + place the cursor on the requested line once the editor is
	// mounted and content is loaded. Re-runs whenever the focus request changes —
	// `focusTick` bumps on each request, so re-selecting the SAME line re-scrolls
	// (it's read into `requestTick` and listed as a dep for exactly that reason).
	// rAF defers until after CodeMirror has laid out the (possibly just-swapped)
	// document so the scroll lands on the right line.
	const isText = document.content.kind === "text";
	const requestTick = focusTick;
	useEffect(() => {
		if (focusLine === undefined || !isText) return;
		void requestTick;
		const frame = requestAnimationFrame(() => {
			editorRef.current?.revealPosition(focusLine, focusColumn ?? 1);
		});
		return () => cancelAnimationFrame(frame);
	}, [focusLine, focusColumn, requestTick, isText]);

	if (document.content.kind !== "text") {
		return null;
	}

	return (
		<CodeEditor
			key={document.id}
			editorRef={editorRef}
			value={document.content.value}
			language={detectLanguage(filePath)}
			onChange={(next) => document.setContent(next)}
			onSave={() => void document.save()}
			fillHeight
		/>
	);
}
