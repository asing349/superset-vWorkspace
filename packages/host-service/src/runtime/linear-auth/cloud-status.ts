import type { ApiClient } from "../../types";

// Wave-7 M1 — cloud-precedence gate. The local Linear connection may be
// established ONLY when no cloud Linear connection is active. We read the
// authoritative cloud status via the existing cloud Linear `getConnection`
// query (reachable host-side through the cloud API client). A cloud connection
// counts as "active" when a row exists AND it does not need re-connect.
//
// Failure semantics matter for the "zero cloud" goal: in local dev there is no
// reachable cloud (the query throws / is unauthorized). An unreachable cloud
// means "no active cloud connection here", so we treat any error as NOT
// connected — otherwise local connect could never work offline.

export interface CloudLinearStatusDeps {
	api: ApiClient;
	organizationId: string;
}

export async function isCloudLinearConnected({
	api,
	organizationId,
}: CloudLinearStatusDeps): Promise<boolean> {
	try {
		const connection = await api.integration.linear.getConnection.query({
			organizationId,
		});
		return connection !== null && !connection.needsReconnect;
	} catch {
		return false;
	}
}
