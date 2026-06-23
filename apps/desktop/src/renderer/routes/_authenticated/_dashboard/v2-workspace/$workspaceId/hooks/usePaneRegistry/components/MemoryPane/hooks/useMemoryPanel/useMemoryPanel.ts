import { alert } from "@superset/ui/atoms/Alert";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { Playbook, SavedStat } from "../../utils/memoryFormat";

/**
 * Data hook for the Memory panel (B4b). Wraps the host `memory` tRPC procedures
 * the panel needs — `listPlaybooks`, `savedStats`, `getPlaybook` (detail), and
 * `forget` — and exposes them as a small, declarative surface. The renderer
 * stays browser-safe: every byte comes over tRPC.
 */
export interface UseMemoryPanelResult {
	playbooks: Playbook[];
	/** True only while the FIRST playbook fetch is in flight (no cached rows). */
	isLoadingPlaybooks: boolean;
	savedStats: SavedStat[];
	/** Detail for the selected playbook, or null when none is selected/loaded. */
	selectedPlaybook: Playbook | null;
	isLoadingSelected: boolean;
	/** Tombstone+delete a playbook (one-click "Forget"), behind a confirm. */
	forgetPlaybook: (playbook: Pick<Playbook, "id" | "intent">) => void;
	isForgetting: boolean;
	refetch: () => void;
}

export function useMemoryPanel({
	projectId,
	selectedPlaybookId,
}: {
	projectId: string;
	selectedPlaybookId: string | null;
}): UseMemoryPanelResult {
	const utils = workspaceTrpc.useUtils();

	const playbooksQuery = workspaceTrpc.memory.listPlaybooks.useQuery(
		{ projectId },
		{ refetchOnWindowFocus: true, staleTime: 5_000 },
	);

	const statsQuery = workspaceTrpc.memory.savedStats.useQuery(
		{ projectId },
		{ refetchOnWindowFocus: true, staleTime: 5_000 },
	);

	const selectedQuery = workspaceTrpc.memory.getPlaybook.useQuery(
		{ id: selectedPlaybookId ?? "" },
		{ enabled: !!selectedPlaybookId, staleTime: 5_000 },
	);

	const forgetMutation = workspaceTrpc.memory.forget.useMutation();

	const forgetPlaybook = useCallback(
		(playbook: Pick<Playbook, "id" | "intent">) => {
			alert({
				title: "Forget this playbook?",
				description: `"${playbook.intent}" will be removed from this project's memory. This action cannot be undone.`,
				actions: [
					{
						label: "Forget",
						variant: "destructive",
						onClick: async () => {
							try {
								await forgetMutation.mutateAsync({ id: playbook.id });
								await Promise.all([
									utils.memory.listPlaybooks.invalidate({ projectId }),
									utils.memory.savedStats.invalidate({ projectId }),
								]);
								toast.success("Forgotten");
							} catch (error) {
								toast.error(
									`Couldn't forget playbook: ${
										error instanceof Error ? error.message : "unknown error"
									}`,
								);
							}
						},
					},
					{ label: "Cancel", variant: "ghost" },
				],
			});
		},
		[forgetMutation, projectId, utils],
	);

	const refetch = useCallback(() => {
		void playbooksQuery.refetch();
		void statsQuery.refetch();
	}, [playbooksQuery, statsQuery]);

	return {
		// Cache-first: render whatever rows we have; isLoading only gates the
		// empty/loading decision when there is no data yet.
		playbooks: playbooksQuery.data ?? [],
		isLoadingPlaybooks: playbooksQuery.isLoading,
		savedStats: statsQuery.data ?? [],
		selectedPlaybook: selectedPlaybookId ? (selectedQuery.data ?? null) : null,
		isLoadingSelected: !!selectedPlaybookId && selectedQuery.isLoading,
		forgetPlaybook,
		isForgetting: forgetMutation.isPending,
		refetch,
	};
}
