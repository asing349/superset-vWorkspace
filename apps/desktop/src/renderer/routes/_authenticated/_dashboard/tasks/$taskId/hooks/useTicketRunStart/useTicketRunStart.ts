import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { TicketRunRequest } from "../../utils/buildTicketRunRequest";

/**
 * Result of launching the autonomous run — the host `ticketRun.start` output
 * (one run row per repo, modeled on `automation_runs`). Derived type-only from
 * the host AppRouter so the renderer stays browser-safe and never hand-rolls a
 * shape that could drift from the host contract.
 */
export type TicketRunStartResult =
	inferRouterOutputs<AppRouter>["ticketRun"]["start"];

interface UseTicketRunStartParams {
	hostUrl: string | null;
}

export interface UseTicketRunStartResult {
	start: (request: TicketRunRequest) => Promise<TicketRunStartResult>;
	isStarting: boolean;
}

/**
 * Imperative launcher for the autonomous ticket -> PR run (B5). Calls the host
 * `ticketRun.start` over tRPC via the vanilla host client — the task detail
 * route has no `WorkspaceClientProvider`, so we don't use the React-Query
 * `workspaceTrpc` proxy here. Electron-safe: the renderer never touches Node.
 */
export function useTicketRunStart({
	hostUrl,
}: UseTicketRunStartParams): UseTicketRunStartResult {
	const [isStarting, setIsStarting] = useState(false);

	const start = useCallback(
		async (request: TicketRunRequest): Promise<TicketRunStartResult> => {
			if (!hostUrl) {
				throw new Error("Host service is not running");
			}
			setIsStarting(true);
			try {
				return await getHostServiceClientByUrl(hostUrl).ticketRun.start.mutate(
					request,
				);
			} finally {
				setIsStarting(false);
			}
		},
		[hostUrl],
	);

	return { start, isStarting };
}
