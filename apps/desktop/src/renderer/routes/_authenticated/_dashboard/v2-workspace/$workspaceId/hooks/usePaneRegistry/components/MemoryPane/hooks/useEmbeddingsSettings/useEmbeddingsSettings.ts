import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useState } from "react";
import type {
	EmbeddingsStatus,
	ReindexResult,
} from "../../utils/embeddingsView";

/**
 * Data hook for the embeddings settings section (B7b). Binds the off-by-default
 * embeddings toggle, the loopback-only detection status, and the reindex action
 * to the host `memory` procedures. Browser-safe — every byte over tRPC, and the
 * host only probes the network when enabled (A5: local-only, off by default).
 */
export interface UseEmbeddingsSettingsResult {
	status: EmbeddingsStatus | null;
	isLoading: boolean;
	isUpdating: boolean;
	isReindexing: boolean;
	/** The latest reindex result for the "nothing to do / embedded N" note. */
	lastReindex: ReindexResult | null;
	/** Flip the toggle → setEmbeddingsEnabled; surfaces a non-loopback rejection. */
	setEnabled: (enabled: boolean) => void;
	/** Reindex embeddings for this project (no-op host-side when off/unavailable). */
	reindex: () => void;
}

const STATUS_INPUT_STALE_MS = 5_000;

export function useEmbeddingsSettings({
	projectId,
}: {
	projectId: string;
}): UseEmbeddingsSettingsResult {
	const utils = workspaceTrpc.useUtils();
	const [lastReindex, setLastReindex] = useState<ReindexResult | null>(null);

	const statusQuery = workspaceTrpc.memory.embeddingsStatus.useQuery(
		{ projectId },
		{ refetchOnWindowFocus: true, staleTime: STATUS_INPUT_STALE_MS },
	);
	const setEnabledMutation =
		workspaceTrpc.memory.setEmbeddingsEnabled.useMutation();
	const reindexMutation = workspaceTrpc.memory.reindexEmbeddings.useMutation();

	const setEnabled = useCallback(
		(enabled: boolean) => {
			setEnabledMutation.mutate(
				{ enabled },
				{
					onSuccess: async () => {
						await utils.memory.embeddingsStatus.invalidate({ projectId });
					},
					// A non-loopback endpoint is rejected with BAD_REQUEST host-side;
					// surface it without crashing.
					onError: (error) =>
						toast.error(`Couldn't update embeddings: ${error.message}`),
				},
			);
		},
		[projectId, setEnabledMutation, utils],
	);

	const reindex = useCallback(() => {
		reindexMutation.mutate(
			{ projectId },
			{
				onSuccess: async (result) => {
					setLastReindex(result);
					await utils.memory.embeddingsStatus.invalidate({ projectId });
				},
				onError: (error) =>
					toast.error(`Couldn't reindex embeddings: ${error.message}`),
			},
		);
	}, [projectId, reindexMutation, utils]);

	return {
		// Cache-first: render whatever status we have; isLoading only gates the
		// loading copy when there is no data yet.
		status: statusQuery.data ?? null,
		isLoading: statusQuery.isLoading,
		isUpdating: setEnabledMutation.isPending,
		isReindexing: reindexMutation.isPending,
		lastReindex,
		setEnabled,
		reindex,
	};
}
