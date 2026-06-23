import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { MemoryGraph } from "../../utils/graphInteraction";

/**
 * Data hook for the knowledge-graph section (B6). Reads `memory.graph` and
 * exposes `memory.regenerateVault` (write the on-disk Obsidian vault). The
 * renderer stays browser-safe — all fs/graph work is host-side over tRPC.
 */
export interface UseMemoryGraphResult {
	graph: MemoryGraph;
	isLoading: boolean;
	/** Regenerate the on-disk vault, then toast the result. */
	regenerateVault: () => void;
	isRegenerating: boolean;
	refetch: () => void;
}

const EMPTY_GRAPH: MemoryGraph = { nodes: [], edges: [] };

export function useMemoryGraph({
	projectId,
}: {
	projectId: string;
}): UseMemoryGraphResult {
	const graphQuery = workspaceTrpc.memory.graph.useQuery(
		{ projectId },
		{ refetchOnWindowFocus: true, staleTime: 5_000 },
	);
	const regenerate = workspaceTrpc.memory.regenerateVault.useMutation();

	const regenerateVault = useCallback(() => {
		regenerate.mutate(
			{ projectId },
			{
				onSuccess: (result) =>
					toast.success(
						`Vault regenerated: ${result.written} note${
							result.written === 1 ? "" : "s"
						}${result.pruned > 0 ? `, ${result.pruned} pruned` : ""}`,
					),
				onError: (error) =>
					toast.error(`Couldn't regenerate vault: ${error.message}`),
			},
		);
	}, [projectId, regenerate]);

	return {
		// Cache-first: render whatever graph we have; isLoading only gates the
		// empty/loading copy when there is no data yet.
		graph: graphQuery.data ?? EMPTY_GRAPH,
		isLoading: graphQuery.isLoading,
		regenerateVault,
		isRegenerating: regenerate.isPending,
		refetch: () => {
			void graphQuery.refetch();
		},
	};
}
