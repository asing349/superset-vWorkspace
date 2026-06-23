import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useState } from "react";
import {
	type ConsolidationProposal,
	canRevert,
	type PracticeScope,
} from "../../utils/practiceReview";

/**
 * Data hook for the consolidation (practice) section (B5). Owns the
 * propose → review → accept / revert flow over the host `memory` procedures.
 * Renderer stays browser-safe: all fs/git/db work is host-side over tRPC.
 */
export interface UsePracticeConsolidationResult {
	/** The active proposal under review, or null when idle. */
	proposal: ConsolidationProposal | null;
	/** The scope of the active proposal. */
	activeScope: PracticeScope | null;
	isProposing: boolean;
	isAccepting: boolean;
	isReverting: boolean;
	/** Latest accepted practice content for a scope (for "current" display). */
	practiceContent: (scope: PracticeScope) => string;
	/** Whether a revert is possible for the active scope (history ≥ 2). */
	revertAvailable: boolean;
	/** Provenance of the latest accepted version for the active scope. */
	latestProvenance: string | null;
	/** Run consolidation for a scope → opens the review with a proposal. */
	propose: (scope: PracticeScope) => void;
	/** Accept the (possibly edited) content → write + version, then refetch. */
	accept: (content: string) => void;
	/** Revert to the prior version for the active scope, then refetch. */
	revert: () => void;
	/** Dismiss the current proposal without writing. */
	cancel: () => void;
}

export function usePracticeConsolidation({
	projectId,
}: {
	projectId: string;
}): UsePracticeConsolidationResult {
	const utils = workspaceTrpc.useUtils();
	const [proposal, setProposal] = useState<ConsolidationProposal | null>(null);
	const [activeScope, setActiveScope] = useState<PracticeScope | null>(null);

	// Current practice docs (project + global) for "current" display + provenance.
	const projectDoc = workspaceTrpc.memory.getPractice.useQuery({
		scope: "project",
		projectId,
	});
	const globalDoc = workspaceTrpc.memory.getPractice.useQuery({
		scope: "global",
		projectId: null,
	});
	const projectVersions = workspaceTrpc.memory.listPracticeVersions.useQuery({
		scope: "project",
		projectId,
	});
	const globalVersions = workspaceTrpc.memory.listPracticeVersions.useQuery({
		scope: "global",
		projectId: null,
	});

	const consolidate = workspaceTrpc.memory.consolidatePractice.useMutation();
	const acceptMutation = workspaceTrpc.memory.acceptPractice.useMutation();
	const revertMutation = workspaceTrpc.memory.revertPractice.useMutation();

	const scopeArgs = useCallback(
		(scope: PracticeScope) => ({
			scope,
			projectId: scope === "global" ? null : projectId,
		}),
		[projectId],
	);

	const refetchScope = useCallback(
		async (scope: PracticeScope) => {
			await Promise.all([
				utils.memory.getPractice.invalidate(scopeArgs(scope)),
				utils.memory.listPracticeVersions.invalidate(scopeArgs(scope)),
			]);
		},
		[scopeArgs, utils],
	);

	const propose = useCallback(
		(scope: PracticeScope) => {
			consolidate.mutate(scopeArgs(scope), {
				onSuccess: (result) => {
					setProposal(result);
					setActiveScope(scope);
				},
				onError: (error) =>
					toast.error(`Couldn't build a proposal: ${error.message}`),
			});
		},
		[consolidate, scopeArgs],
	);

	const accept = useCallback(
		(content: string) => {
			if (!proposal || !activeScope) return;
			acceptMutation.mutate(
				{ ...scopeArgs(activeScope), content, provenance: proposal.provenance },
				{
					onSuccess: async () => {
						await refetchScope(activeScope);
						setProposal(null);
						setActiveScope(null);
						toast.success("Coding practice updated");
					},
					onError: (error) =>
						toast.error(`Couldn't save practice: ${error.message}`),
				},
			);
		},
		[acceptMutation, activeScope, proposal, refetchScope, scopeArgs],
	);

	const revert = useCallback(() => {
		if (!activeScope) return;
		revertMutation.mutate(scopeArgs(activeScope), {
			onSuccess: async () => {
				await refetchScope(activeScope);
				toast.success("Reverted to the previous version");
			},
			onError: (error) => toast.error(`Couldn't revert: ${error.message}`),
		});
	}, [activeScope, refetchScope, revertMutation, scopeArgs]);

	const cancel = useCallback(() => {
		setProposal(null);
		setActiveScope(null);
	}, []);

	const practiceContent = useCallback(
		(scope: PracticeScope) =>
			(scope === "global" ? globalDoc.data : projectDoc.data)?.latest
				?.content ?? "",
		[globalDoc.data, projectDoc.data],
	);

	const versionCount =
		activeScope === "global"
			? (globalVersions.data?.length ?? 0)
			: (projectVersions.data?.length ?? 0);

	const latestProvenance =
		(activeScope === "global" ? globalDoc.data : projectDoc.data)?.latest
			?.provenance ?? null;

	return {
		proposal,
		activeScope,
		isProposing: consolidate.isPending,
		isAccepting: acceptMutation.isPending,
		isReverting: revertMutation.isPending,
		practiceContent,
		revertAvailable: canRevert(versionCount),
		latestProvenance,
		propose,
		accept,
		revert,
		cancel,
	};
}
