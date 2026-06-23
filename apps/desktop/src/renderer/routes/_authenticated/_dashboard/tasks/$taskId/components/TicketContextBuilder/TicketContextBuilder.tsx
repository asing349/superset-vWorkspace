import { WorkspaceClientProvider } from "@superset/workspace-client";
import {
	getHostServiceHeaders,
	getHostServiceWsToken,
} from "renderer/lib/host-service-auth";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { TicketContextSource } from "../../utils/buildTicketContext";
import { TicketContextBuilderInner } from "./components/TicketContextBuilderInner";

interface TicketContextBuilderProps {
	ticket: TicketContextSource;
}

/**
 * "Add any context for this ticket?" + a no-cap draft-context builder mounted in
 * the task detail panel (B2). The draft is assembled from the ticket, the
 * developer's optional input, and wave-3 memory pulled via the host
 * `memory.retrieve` tRPC.
 *
 * The task detail route lives outside any v2-workspace, so — like
 * `DaemonAutoUpdateFailureDialog` — we mount our own `WorkspaceClientProvider`
 * scoped to the active host URL so the inner component can call
 * `workspaceTrpc.memory.retrieve`.
 */
export function TicketContextBuilder({ ticket }: TicketContextBuilderProps) {
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
			<TicketContextBuilderInner ticket={ticket} projectId={null} />
		</WorkspaceClientProvider>
	);
}
