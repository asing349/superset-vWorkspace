import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

/**
 * Tracks which PRs have already been answered for the Superset Memory (B2)
 * "Save how I did this to this project's memory?" prompt, so it is shown at most
 * once per PR (non-nagging). Persisted across restarts and keyed by a stable
 * `${projectId}:${prNumber}` so re-opening a workspace never re-prompts. Both
 * Save and Skip mark the PR answered; only Save persists a Playbook.
 */

/** Build the stable per-PR key. */
export function promptKey(projectId: string, prNumber: number): string {
	return `${projectId}:${prNumber}`;
}

interface MemoryCapturePromptState {
	/** Map of `${projectId}:${prNumber}` → epoch ms when answered. */
	answeredAt: Record<string, number>;
	/** Mark a PR's prompt as answered (Save or Skip). */
	markAnswered: (projectId: string, prNumber: number) => void;
	/** Whether the prompt for this PR has already been answered. */
	isAnswered: (projectId: string, prNumber: number) => boolean;
}

export const useMemoryCapturePromptStore = create<MemoryCapturePromptState>()(
	devtools(
		persist(
			(set, get) => ({
				answeredAt: {},
				markAnswered: (projectId, prNumber) =>
					set((state) => ({
						answeredAt: {
							...state.answeredAt,
							[promptKey(projectId, prNumber)]: Date.now(),
						},
					})),
				isAnswered: (projectId, prNumber) =>
					promptKey(projectId, prNumber) in get().answeredAt,
			}),
			{ name: "memory-capture-prompt-v1" },
		),
		{ name: "MemoryCapturePrompt" },
	),
);
