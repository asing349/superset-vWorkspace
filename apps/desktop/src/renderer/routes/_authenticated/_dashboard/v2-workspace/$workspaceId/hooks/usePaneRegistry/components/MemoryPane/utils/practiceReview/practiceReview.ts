import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Pure decision logic for the consolidation review flow (B5). No React/tRPC —
 * extracted so the section's behavior is unit-testable (the renderer test
 * harness is pure `bun:test`, no DOM). The component wires these to queries +
 * the `MemoryPanelHeader` actions slot.
 */

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type ConsolidationProposal =
	RouterOutputs["memory"]["consolidatePractice"];
export type PracticeVersion = RouterOutputs["memory"]["acceptPractice"];
export type PracticeScope = ConsolidationProposal["scope"];

/** The two consolidation scopes the buttons drive. */
export const PRACTICE_SCOPES: readonly {
	scope: PracticeScope;
	label: string;
}[] = [
	{ scope: "project", label: "Update this project's coding practice" },
	{ scope: "global", label: "Update my global coding practice" },
];

/**
 * Whether the "Accept" button should be enabled: there must be an active
 * proposal, and the (possibly edited) content must differ from the current doc
 * — accepting an identical doc is a no-op we suppress.
 */
export function canAccept(args: {
	proposal: ConsolidationProposal | null;
	editedContent: string;
}): boolean {
	if (!args.proposal) return false;
	return args.editedContent.trim() !== args.proposal.currentDoc.trim();
}

/**
 * Whether a Revert is available: a prior version must exist (history length ≥ 2,
 * since reverting restores the version *before* the latest).
 */
export function canRevert(versionCount: number): boolean {
	return versionCount >= 2;
}

/** The content to send to `acceptPractice` — the user's edits, or the proposed doc. */
export function contentToAccept(args: {
	proposal: ConsolidationProposal;
	editedContent: string | null;
}): string {
	return args.editedContent ?? args.proposal.proposedDoc;
}

/** A short human summary of what accepting will do, for the confirm UI. */
export function acceptSummary(proposal: ConsolidationProposal): string {
	const target = proposal.scope === "global" ? "global" : "this project's";
	const n = proposal.sourceCount;
	return `Update ${target} coding practice from ${n} confirmed playbook${
		n === 1 ? "" : "s"
	}.`;
}

/** Whether the proposal would actually change anything vs the current doc. */
export function proposalHasChanges(proposal: ConsolidationProposal): boolean {
	return proposal.diff.added > 0 || proposal.diff.removed > 0;
}
