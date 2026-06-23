import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import { useMemoryCapturePromptStore } from "renderer/stores/memory-capture-prompt";
import type { PRFlowState } from "../../components/PRActionHeader/utils/getPRFlowState";

/**
 * The minimal PR identity the capture prompt needs. Derived from the PR-flow
 * state so the prompt only ever fires for a PR that actually exists.
 */
export interface CapturePromptTarget {
	prNumber: number;
	prUrl: string;
	prTitle: string;
}

/**
 * Pure decision: should the "Save to memory?" prompt show right now? Yes iff a
 * PR exists (the `pr-exists` flow state) AND it hasn't been answered yet for
 * this `(projectId, prNumber)`. Extracted for unit testing — no React/tRPC.
 */
export function selectCapturePromptTarget(
	state: PRFlowState,
): CapturePromptTarget | null {
	if (state.kind !== "pr-exists") return null;
	const { pr } = state;
	if (typeof pr.number !== "number") return null;
	return { prNumber: pr.number, prUrl: pr.url, prTitle: pr.title };
}

export interface UseMemoryCapturePromptResult {
	/** The PR to prompt for, or null when nothing should show. */
	target: CapturePromptTarget | null;
	/** Whether a save is currently in flight. */
	isSaving: boolean;
	/** Persist a provisional Playbook for this PR (host-distilled, local-only). */
	onSave: () => void;
	/** Dismiss without persisting; the PR is marked answered (won't re-prompt). */
	onSkip: () => void;
}

/**
 * Drives the Superset Memory (B2) PR-time prompt. Shows once per PR, project-
 * scoped. On Save it calls the HOST `memory.captureFromPR` procedure, which
 * distills a provisional Playbook from LOCAL data (git diff + PR metadata) with
 * no model and no new network egress — the renderer stays browser-safe.
 */
export function useMemoryCapturePrompt({
	workspaceId,
	projectId,
	flowState,
}: {
	workspaceId: string;
	/** v2 project this workspace belongs to (`workspace.projectId`). */
	projectId: string;
	flowState: PRFlowState;
}): UseMemoryCapturePromptResult {
	const isAnswered = useMemoryCapturePromptStore((s) => s.isAnswered);
	const markAnswered = useMemoryCapturePromptStore((s) => s.markAnswered);
	const captureFromPR = workspaceTrpc.memory.captureFromPR.useMutation();

	const candidate = selectCapturePromptTarget(flowState);
	const target =
		candidate && !isAnswered(projectId, candidate.prNumber) ? candidate : null;

	const onSkip = useCallback(() => {
		if (!target) return;
		markAnswered(projectId, target.prNumber);
	}, [markAnswered, projectId, target]);

	const onSave = useCallback(() => {
		if (!target) return;
		// Mark answered immediately so the prompt closes and never re-nags, even
		// if the async capture is still settling.
		markAnswered(projectId, target.prNumber);
		captureFromPR.mutate(
			{
				workspaceId,
				projectId,
				prNumber: target.prNumber,
				prUrl: target.prUrl,
				prTitle: target.prTitle,
			},
			{
				onSuccess: () => toast.success("Saved to this project's memory"),
				onError: (error) =>
					toast.error(`Couldn't save to memory: ${error.message}`),
			},
		);
	}, [captureFromPR, markAnswered, projectId, target, workspaceId]);

	return {
		target,
		isSaving: captureFromPR.isPending,
		onSave,
		onSkip,
	};
}
