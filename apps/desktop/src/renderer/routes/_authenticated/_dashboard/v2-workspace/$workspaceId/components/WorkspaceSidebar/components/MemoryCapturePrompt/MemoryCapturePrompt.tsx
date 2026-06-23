import { Button } from "@superset/ui/button";
import { VscLoading, VscSparkle } from "react-icons/vsc";
import { useMemoryCapturePrompt } from "../../hooks/useMemoryCapturePrompt";
import type { PRFlowState } from "../PRActionHeader/utils/getPRFlowState";

interface MemoryCapturePromptProps {
	workspaceId: string;
	/** v2 project this workspace belongs to (`workspace.projectId`). */
	projectId: string;
	flowState: PRFlowState;
}

/**
 * Superset Memory (B2) PR-time prompt. When a PR has just been opened/created
 * (the `pr-exists` flow state), this renders a single, non-nagging,
 * project-scoped banner: "Save how I did this to this project's memory?" with
 * [Save] / [Skip]. Shown at most once per PR (the hook + persisted store gate
 * it). Save persists a provisional Playbook distilled HOST-side from local data
 * (git diff + PR title) — no model, no new egress. Skip persists nothing.
 */
export function MemoryCapturePrompt({
	workspaceId,
	projectId,
	flowState,
}: MemoryCapturePromptProps) {
	const { target, isSaving, onSave, onSkip } = useMemoryCapturePrompt({
		workspaceId,
		projectId,
		flowState,
	});

	if (!target) return null;

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
			<VscSparkle className="size-4 shrink-0 text-muted-foreground" />
			<p className="min-w-0 flex-1 text-xs text-muted-foreground select-text">
				Save how I did this to this project's memory?
			</p>
			<Button
				variant="ghost"
				size="xs"
				onClick={onSkip}
				disabled={isSaving}
				aria-label="Skip saving to memory"
			>
				Skip
			</Button>
			<Button
				variant="secondary"
				size="xs"
				onClick={onSave}
				disabled={isSaving}
				aria-label="Save to this project's memory"
			>
				{isSaving ? <VscLoading className="size-3.5 animate-spin" /> : null}
				Save
			</Button>
		</div>
	);
}
