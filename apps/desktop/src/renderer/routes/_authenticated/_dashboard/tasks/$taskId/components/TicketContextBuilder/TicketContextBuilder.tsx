import { WorkspaceClientProvider } from "@superset/workspace-client";
import {
	getHostServiceHeaders,
	getHostServiceWsToken,
} from "renderer/lib/host-service-auth";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { UseTicketContextApprovalResult } from "../../hooks/useTicketContextApproval";
import type { TicketContextSource } from "../../utils/buildTicketContext";
import { TicketContextBuilderInner } from "./components/TicketContextBuilderInner";

interface TicketContextBuilderProps {
	ticket: TicketContextSource;
	/**
	 * The PRIMARY repo's projectId (lifted from B4's `TicketRunLauncher`). Scopes
	 * memory retrieval AND keys the approved context store `(projectId, taskId)`.
	 */
	projectId: string | null;
	/** Shared approval state (the single gate), owned by the page. */
	approval: UseTicketContextApprovalResult;
}

/**
 * "Add any context for this ticket?" + a no-cap draft-context builder and the
 * single human gate (review / edit / APPROVE) mounted in the task detail panel
 * (B2 + B3). The draft is assembled from the ticket, the developer's optional
 * input, and wave-3 memory pulled via the host `memory.retrieve` tRPC; the
 * approved content is persisted via `ticketContext.saveApproved`.
 *
 * The task detail route lives outside any v2-workspace, so — like
 * `DaemonAutoUpdateFailureDialog` — we mount our own `WorkspaceClientProvider`
 * scoped to the active host URL so the inner component can call
 * `workspaceTrpc.memory.retrieve`.
 */
export function TicketContextBuilder({
	ticket,
	projectId,
	approval,
}: TicketContextBuilderProps) {
	const { activeHostUrl } = useLocalHostService();

	// Cache-first / availability: the host service backs memory retrieval. When
	// it isn't up yet there is nothing to retrieve, so render nothing rather than
	// a broken builder; it appears once the host is running.
	if (!activeHostUrl) return null;

	return (
		<WorkspaceClientProvider
			cacheKey="ticket-context-builder"
			key={activeHostUrl}
			hostUrl={activeHostUrl}
			headers={() => getHostServiceHeaders(activeHostUrl)}
			wsToken={() => getHostServiceWsToken(activeHostUrl)}
		>
			<TicketContextBuilderInner
				ticket={ticket}
				projectId={projectId}
				approval={approval}
			/>
		</WorkspaceClientProvider>
	);
}
