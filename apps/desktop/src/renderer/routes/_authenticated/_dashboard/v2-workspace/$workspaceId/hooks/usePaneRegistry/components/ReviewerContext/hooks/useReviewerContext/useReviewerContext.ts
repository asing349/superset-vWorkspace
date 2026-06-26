import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback } from "react";
import type { ReviewerContextStatus } from "../../types";

/**
 * Owns the per-project reviewer onboarding / refresh flow (Wave 6, M5) — the
 * wave-5/6 `useGenerateGuide` / `useReviewPr` pattern.
 *
 * Read path (cache-first): `reviewer.getContextStatus` is a QUERY that onboards
 * / refreshes NOTHING — it only returns the config + flag-only staleness + the
 * authoritative on-demand diff. We render that immediately.
 *
 * Write path (button-only): `reviewer.setup` and `reviewer.refreshContext` are
 * MUTATIONS, the sole triggers, invoked ONLY from a button onClick (never an
 * effect / onMount) — onboarding/refresh stays explicit. On success we
 * invalidate the status read so the freshly-persisted config flows back through
 * the single read path; a refresh additionally toasts WHAT changed.
 */

/** The setup/refresh actions, shareable by views that already hold a status. */
export interface ReviewerContextActions {
	setUp: () => void;
	refresh: () => void;
	isSettingUp: boolean;
	isRefreshing: boolean;
}

export interface UseReviewerContextResult extends ReviewerContextActions {
	status: ReviewerContextStatus | null;
	isLoading: boolean;
}

/** Just the mutations + their invalidations, for a card fed status externally. */
export function useReviewerContextActions({
	projectId,
}: {
	projectId: string;
}): ReviewerContextActions {
	const utils = workspaceTrpc.useUtils();

	const invalidate = useCallback(() => {
		void utils.reviewer.getContextStatus.invalidate({ projectId });
		void utils.reviewer.getConfig.invalidate({ projectId });
		void utils.reviewer.shouldShowSetupCard.invalidate({ projectId });
		void utils.reviewer.listContextStatus.invalidate();
	}, [projectId, utils]);

	const setupMutation = workspaceTrpc.reviewer.setup.useMutation({
		onSuccess: () => {
			invalidate();
			toast.success("AI reviewer set up", {
				description: "Grounded on this project's current context.",
			});
		},
		onError: (error) => {
			toast.error("Couldn't set up the AI reviewer", {
				description: error.message,
			});
		},
	});

	const refreshMutation = workspaceTrpc.reviewer.refreshContext.useMutation({
		onSuccess: (result) => {
			invalidate();
			if (result.diff.changed) {
				const detail =
					result.diff.changes.map((c) => c.detail).join("; ") ||
					"Context updated.";
				toast.success("Context refreshed", { description: detail });
			} else {
				toast.success("Context is already up to date");
			}
		},
		onError: (error) => {
			toast.error("Couldn't refresh the context", {
				description: error.message,
			});
		},
	});

	const setUp = useCallback(() => {
		// Sole trigger. Called only from the "Set up AI reviewer" button onClick.
		setupMutation.mutate({ projectId });
	}, [projectId, setupMutation]);

	const refresh = useCallback(() => {
		// Sole trigger. Called only from the "Refresh context" button onClick.
		refreshMutation.mutate({ projectId });
	}, [projectId, refreshMutation]);

	return {
		setUp,
		refresh,
		isSettingUp: setupMutation.isPending,
		isRefreshing: refreshMutation.isPending,
	};
}

export function useReviewerContext({
	projectId,
}: {
	projectId: string;
}): UseReviewerContextResult {
	const statusQuery = workspaceTrpc.reviewer.getContextStatus.useQuery(
		{ projectId },
		// The status changes only on an explicit (re)setup/refresh or a listener
		// flag, so it never needs background refetching while the pane is open.
		{ staleTime: Number.POSITIVE_INFINITY, enabled: Boolean(projectId) },
	);
	const actions = useReviewerContextActions({ projectId });

	return {
		status: statusQuery.data ?? null,
		isLoading: statusQuery.isLoading,
		...actions,
	};
}
