/**
 * Pure presentation helper (Wave 6, M6) mapping a project's observed business
 * rules onto the counts + badge the Manage-context card renders. Decoupled from
 * the inferred host type via a minimal structural input so it is unit-testable
 * without the tRPC client (the desktop renderer has no DOM-render test infra —
 * pure helpers carry the coverage).
 */

/** Minimal structural view of one observed rule (the curation `state`). */
export interface BusinessRuleLike {
	state: "proposed" | "accepted" | "reverted";
}

export interface BusinessRulesSummary {
	/** Accepted rules — the ones grounding later reviews. */
	accepted: number;
	/** Pending proposals awaiting curation. */
	proposed: number;
	/** Retired/rejected rules (kept for audit). */
	reverted: number;
	/** Whether there are pending proposals the developer should curate. */
	hasPending: boolean;
	/** Short badge label for the rules section header. */
	badgeLabel: string;
}

/**
 * Summarize a project's observed business rules. Accepted rules are the active
 * grounding; pending proposals are surfaced so the developer curates them. An
 * empty layer reads "No rules yet".
 */
export function summarizeBusinessRules(
	rules: readonly BusinessRuleLike[],
): BusinessRulesSummary {
	let accepted = 0;
	let proposed = 0;
	let reverted = 0;
	for (const rule of rules) {
		if (rule.state === "accepted") accepted += 1;
		else if (rule.state === "proposed") proposed += 1;
		else reverted += 1;
	}

	const parts: string[] = [];
	if (accepted > 0) parts.push(`${accepted} active`);
	if (proposed > 0) parts.push(`${proposed} pending`);
	const badgeLabel = parts.length > 0 ? parts.join(" · ") : "No rules yet";

	return { accepted, proposed, reverted, hasPending: proposed > 0, badgeLabel };
}
