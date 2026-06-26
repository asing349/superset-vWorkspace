/**
 * Pure presentation helper (Wave 6, M5) mapping a project's reviewer-context
 * status onto the badge + copy the onboarding card / refresh affordance / manage
 * cards render. Decoupled from the inferred host type via a minimal structural
 * input so it is unit-testable without the tRPC client (the desktop renderer has
 * no DOM-render test infra — pure helpers carry the coverage).
 */

export interface ReviewerContextSummaryInput {
	/** True once "Set up AI reviewer" has run + is enabled. */
	configured: boolean;
	/** The flag-only staleness set by the host listeners. */
	stale: boolean;
	diff: {
		changed: boolean;
		changes: { kind: string; detail: string }[];
	};
}

export type ReviewerContextState = "not-configured" | "ready" | "changed";

export interface ReviewerContextSummary {
	state: ReviewerContextState;
	/** Short badge label for the state. */
	badgeLabel: string;
	/** One-line description for the card body. */
	description: string;
	/** Per-change detail strings (empty unless `state === "changed"`). */
	changeDetails: string[];
	/** Whether a "Refresh context" affordance should be offered. */
	canRefresh: boolean;
}

/**
 * The reviewer context is "changed" when EITHER the host flipped the cheap
 * `stale` flag (a listener saw practice/index/head move) OR the authoritative
 * on-demand diff differs from the snapshot. Either way the UI offers a refresh —
 * it never refreshes on its own.
 */
export function summarizeReviewerContext(
	status: ReviewerContextSummaryInput | null,
): ReviewerContextSummary {
	if (!status || !status.configured) {
		return {
			state: "not-configured",
			badgeLabel: "Not set up",
			description:
				"Set up the AI reviewer to ground reviews in this project's coding practice, project index, and playbooks.",
			changeDetails: [],
			canRefresh: false,
		};
	}

	const changed = status.stale || status.diff.changed;
	if (changed) {
		// Prefer the precise per-layer diff; fall back to a generic line when only
		// the flag is set (a listener fired but the fingerprint hasn't been re-read).
		const changeDetails =
			status.diff.changes.length > 0
				? status.diff.changes.map((c) => c.detail)
				: ["This project's context changed since setup."];
		return {
			state: "changed",
			badgeLabel: "Context changed",
			description:
				"This project's context changed since setup. Refresh to re-ground the reviewer.",
			changeDetails,
			canRefresh: true,
		};
	}

	return {
		state: "ready",
		badgeLabel: "Ready",
		description: "Grounded on this project's current context.",
		changeDetails: [],
		canRefresh: true,
	};
}
