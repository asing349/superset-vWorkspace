import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

/**
 * Shared state for the single human gate: the developer-APPROVED ticket context,
 * keyed `(projectId, taskId)` host-side. Wraps the host `ticketContext`
 * `getApproved`/`saveApproved` tRPC procedures via the vanilla host client (the
 * task detail route has no `WorkspaceClientProvider`), so both the approve UI
 * (B3) and the run launcher's gate (B4) read the SAME approval state.
 *
 * `projectId` is the PRIMARY repo's projectId (from B4's `onPrimaryProjectChange`).
 */
interface UseTicketContextApprovalParams {
	hostUrl: string | null;
	projectId: string | null;
	/** Cloud task id; `null` until the task resolves (gates the query). */
	taskId: string | null;
}

export interface UseTicketContextApprovalResult {
	/** The persisted approved Markdown, or `null` when nothing is approved yet. */
	approvedContent: string | null;
	/** True once the approval query has resolved (gates the empty-vs-loading view). */
	isApprovalLoaded: boolean;
	/** True while the gate cannot yet be evaluated (no host or no primary repo). */
	isGateUnavailable: boolean;
	/** Persist the edited content as the approved context for this ticket. */
	approve: (params: { content: string }) => Promise<void>;
	isApproving: boolean;
}

function approvalQueryKey(params: {
	projectId: string | null;
	taskId: string | null;
}): readonly unknown[] {
	return ["ticket-context-approved", params.projectId, params.taskId];
}

export function useTicketContextApproval({
	hostUrl,
	projectId,
	taskId,
}: UseTicketContextApprovalParams): UseTicketContextApprovalResult {
	const queryClient = useQueryClient();
	const isEnabled = hostUrl !== null && projectId !== null && taskId !== null;

	const approvedQuery = useQuery({
		queryKey: approvalQueryKey({ projectId, taskId }),
		queryFn: async (): Promise<string | null> => {
			// Guarded by `enabled`; these are non-null here.
			if (!hostUrl || !projectId || !taskId) return null;
			return getHostServiceClientByUrl(hostUrl).ticketContext.getApproved.query(
				{
					projectId,
					taskId,
				},
			);
		},
		enabled: isEnabled,
		staleTime: 5_000,
	});

	const approveMutation = useMutation({
		mutationFn: async (params: { content: string }): Promise<void> => {
			if (!hostUrl || !projectId || !taskId) {
				throw new Error("Select a repo before approving the context");
			}
			await getHostServiceClientByUrl(
				hostUrl,
			).ticketContext.saveApproved.mutate({
				projectId,
				taskId,
				content: params.content,
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: approvalQueryKey({ projectId, taskId }),
			});
		},
	});

	const approve = useCallback(
		async (params: { content: string }): Promise<void> => {
			await approveMutation.mutateAsync(params);
		},
		[approveMutation],
	);

	return {
		// Cache-first: surface whatever the query returns; `isApprovalLoaded` only
		// distinguishes "no approval yet" from "still loading" when there's no data.
		approvedContent: approvedQuery.data ?? null,
		isApprovalLoaded: isEnabled && approvedQuery.isSuccess,
		isGateUnavailable: !isEnabled,
		approve,
		isApproving: approveMutation.isPending,
	};
}
