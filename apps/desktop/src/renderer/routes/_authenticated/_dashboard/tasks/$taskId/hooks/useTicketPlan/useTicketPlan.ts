import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { TicketRunRequest } from "../../utils/buildTicketRunRequest";
export type ReviewedTicketPlan =
	inferRouterOutputs<AppRouter>["ticketPlan"]["prepare"];

export function useTicketPlan({
	hostUrl,
	request,
	approvedContent,
}: {
	hostUrl: string | null;
	request: TicketRunRequest | null;
	approvedContent: string | null;
}) {
	const key = JSON.stringify([hostUrl, request, approvedContent]);
	const [state, setState] = useState<{
		key: string;
		record: ReviewedTicketPlan;
		content: string;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<{
		key: string;
		message: string;
	} | null>(null);
	const current = state?.key === key ? state : null;
	async function analyze(revise = false) {
		if (!hostUrl || !request) return;
		setPending(true);
		setFailure(null);
		// Invalidate approval immediately while the next review is running.
		if (current)
			setState({
				...current,
				record: { ...current.record, state: "reviewing" },
			});
		try {
			const client = getHostServiceClientByUrl(hostUrl).ticketPlan;
			const record =
				revise && current
					? await client.review.mutate({
							planId: current.record.id,
							plan: current.content,
						})
					: await client.prepare.mutate(request);
			setState({ key, record, content: record.plan });
		} catch (error) {
			setFailure({
				key,
				message:
					error instanceof Error
						? error.message
						: "Plan review failed. Execution remains blocked.",
			});
		} finally {
			setPending(false);
		}
	}
	return {
		record: current?.record ?? null,
		content: current?.content ?? "",
		pending,
		error: failure?.key === key ? failure.message : null,
		approvedPlanId:
			!pending &&
			current?.record.state === "approved" &&
			current.content === current.record.plan
				? current.record.id
				: null,
		invalidate: () => {
			if (current)
				setState({
					...current,
					record: { ...current.record, state: "consumed" },
				});
		},
		setContent: (content: string) => {
			if (current) setState({ ...current, content });
		},
		prepare: () => analyze(),
		review: () => analyze(true),
	};
}
