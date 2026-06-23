import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Pure presentation helpers for the Memory panel (B4b). No React, no I/O — all
 * data shaping/formatting lives here so it is unit-testable and the components
 * stay declarative.
 */

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type Playbook = RouterOutputs["memory"]["getPlaybook"];
export type PlaybookStatus = Playbook["status"];
export type SavedStat = RouterOutputs["memory"]["savedStats"][number];

/**
 * Format the headline token-savings stat. Picks the `tokens` metric (falls back
 * to the first metric with paired samples) and renders "Memory saved ~X%".
 * Returns a friendly empty string when there is no paired data yet — the panel
 * must degrade gracefully, never show "NaN%" or a bare 0.
 */
export function formatSavedHeadline(stats: readonly SavedStat[]): string {
	const usable = stats.filter((s) => s.sampleCount > 0);
	if (usable.length === 0) return "No data yet";

	const chosen =
		usable.find((s) => s.metric === "tokens") ?? (usable[0] as SavedStat);
	// A negative saved fraction means memory cost more than it saved on average;
	// surface it honestly rather than hiding it.
	const pct = chosen.savedPercent;
	const verb = pct < 0 ? "cost" : "saved";
	const magnitude = Math.abs(pct);
	return `Memory ${verb} ~${formatPercent(magnitude)}`;
}

/** Render a percentage with at most one decimal, trimming a trailing ".0". */
export function formatPercent(value: number): string {
	if (!Number.isFinite(value)) return "0%";
	const rounded = Math.round(value * 10) / 10;
	const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	return `${text}%`;
}

/** Human label for a Playbook status badge. */
export function statusLabel(status: PlaybookStatus): string {
	switch (status) {
		case "provisional":
			return "Provisional";
		case "confirmed":
			return "Confirmed";
		case "demoted":
			return "Demoted";
		case "archived":
			return "Archived";
		default:
			return status;
	}
}

export type StatusTone = "neutral" | "positive" | "warning" | "muted";

/** Coarse visual tone for a status badge (maps to a chip color in the UI). */
export function statusTone(status: PlaybookStatus): StatusTone {
	switch (status) {
		case "confirmed":
			return "positive";
		case "demoted":
			return "warning";
		case "archived":
			return "muted";
		default:
			return "neutral";
	}
}

/** Whether a Playbook's gotcha was flagged as an anti-pattern by B2 demotion. */
export function isAntiPattern(playbook: Pick<Playbook, "gotcha">): boolean {
	return playbook.gotcha?.startsWith("[anti-pattern]") ?? false;
}

/** Extract the PR number from provenance for a compact "#123" link label. */
export function provenanceLabel(
	provenance: Playbook["provenance"],
): string | null {
	if (provenance.prNumber !== null) return `#${provenance.prNumber}`;
	if (provenance.url) return "link";
	return null;
}

/** A short, one-line confidence label (e.g. "80% confidence"). */
export function confidenceLabel(confidence: number): string {
	const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
	return `${clamped}% confidence`;
}
