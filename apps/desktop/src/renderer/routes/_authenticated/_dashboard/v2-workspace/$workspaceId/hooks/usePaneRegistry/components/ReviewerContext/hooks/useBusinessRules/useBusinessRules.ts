import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { ObservedRule } from "../../types";

/**
 * Owns a project's observed-business-rules curation (Wave 6, M6) — the
 * wave-5/6 mutation-then-invalidate pattern.
 *
 * Read path (cache-first): `businessRules.list` is a QUERY that curates NOTHING;
 * it returns the project's rules (accepted + pending proposals + reverted). We
 * render that immediately.
 *
 * Write path (button-only): `businessRules.accept` / `businessRules.revert` are
 * MUTATIONS, the sole curation triggers, invoked ONLY from a button onClick. On
 * success we invalidate the rules list AND the reviewer context status (accept/
 * revert flips the context `stale` flag host-side, so the card's changed/refresh
 * affordance must re-read). Rules are PROPOSED at review time, never here.
 */

export interface UseBusinessRulesResult {
	rules: ObservedRule[];
	isLoading: boolean;
	accept: (ruleId: string) => void;
	revert: (ruleId: string) => void;
	pendingRuleId: string | null;
}

export function useBusinessRules({
	projectId,
}: {
	projectId: string;
}): UseBusinessRulesResult {
	const utils = workspaceTrpc.useUtils();

	const listQuery = workspaceTrpc.businessRules.list.useQuery(
		{ projectId },
		// Curation is explicit; the list only changes on a review or an accept/
		// revert click, so it never needs background refetching.
		{ staleTime: Number.POSITIVE_INFINITY, enabled: Boolean(projectId) },
	);

	const invalidate = useCallback(() => {
		void utils.businessRules.list.invalidate({ projectId });
		void utils.businessRules.summary.invalidate({ projectId });
		// Accept/revert changes grounding → the reviewer context moved.
		void utils.reviewer.getContextStatus.invalidate({ projectId });
		void utils.reviewer.listContextStatus.invalidate();
	}, [projectId, utils]);

	const acceptMutation = workspaceTrpc.businessRules.accept.useMutation({
		onSuccess: () => {
			invalidate();
			toast.success("Business rule accepted", {
				description: "It now grounds later reviews of this project.",
			});
		},
		onError: (error) => {
			toast.error("Couldn't accept the rule", { description: error.message });
		},
	});

	const revertMutation = workspaceTrpc.businessRules.revert.useMutation({
		onSuccess: () => {
			invalidate();
			toast.success("Business rule reverted");
		},
		onError: (error) => {
			toast.error("Couldn't revert the rule", { description: error.message });
		},
	});

	const accept = useCallback(
		(ruleId: string) => {
			// Sole trigger. Called only from the "Accept" button onClick.
			acceptMutation.mutate({ projectId, ruleId });
		},
		[projectId, acceptMutation],
	);

	const revert = useCallback(
		(ruleId: string) => {
			// Sole trigger. Called only from the "Revert" button onClick.
			revertMutation.mutate({ projectId, ruleId });
		},
		[projectId, revertMutation],
	);

	const pendingRuleId =
		(acceptMutation.isPending
			? acceptMutation.variables?.ruleId
			: revertMutation.isPending
				? revertMutation.variables?.ruleId
				: null) ?? null;

	return {
		rules: listQuery.data ?? [],
		isLoading: listQuery.isLoading,
		accept,
		revert,
		pendingRuleId,
	};
}
