import type { PlaybookProvenance } from "@superset/memory";
import { and, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { memoryPlaybooks } from "../../db/schema.ts";

/**
 * Confirm-on-merge / demote-on-close for Superset Memory B2 (Assumption A3).
 *
 * The PR runtime calls {@link reconcilePlaybooksForPr} whenever a tracked PR
 * transitions to a TERMINAL state:
 *   - merged          → confirm the matching provisional Playbook(s) (+confidence)
 *   - closed-unmerged → demote them, and record a lightweight anti-pattern note
 *                       (A9) so the agent learns what NOT to repeat.
 *
 * Matching is by `(projectId, provenance.prNumber)`. The whole thing is
 * IDEMPOTENT and RESILIENT: a PR with no saved Playbook is a no-op, an
 * already-confirmed/demoted row is skipped, and any error is swallowed (a PR
 * sync must never fail because of memory bookkeeping).
 */

/** Confidence assigned to a Playbook confirmed by a merged PR. */
const CONFIRM_CONFIDENCE = 80;

/** Marker prepended to a demoted Playbook's gotcha to flag an anti-pattern. */
export const ANTI_PATTERN_PREFIX = "[anti-pattern]";

export type PrTerminalState = "merged" | "closed";

interface PlaybookRow {
	id: string;
	status: string;
	gotcha: string | null;
	provenanceJson: string;
}

function parsePrNumber(provenanceJson: string): number | null {
	try {
		const parsed = JSON.parse(provenanceJson) as Partial<PlaybookProvenance>;
		return typeof parsed.prNumber === "number" ? parsed.prNumber : null;
	} catch {
		return null;
	}
}

export interface ReconcileResult {
	confirmed: string[];
	demoted: string[];
}

/**
 * Reconcile the provisional Playbook(s) captured for a PR against its terminal
 * state. Returns the affected ids (useful for tests/telemetry). Never throws.
 */
export function reconcilePlaybooksForPr({
	db,
	projectId,
	prNumber,
	terminalState,
	now = Date.now(),
}: {
	db: HostDb;
	projectId: string;
	prNumber: number;
	terminalState: PrTerminalState;
	now?: number;
}): ReconcileResult {
	const result: ReconcileResult = { confirmed: [], demoted: [] };
	try {
		// Pull every provisional Playbook for this project, then match on the
		// PR number stored in provenance (JSON, so filtered in JS). Already
		// confirmed/demoted/archived rows are intentionally excluded — that is
		// what makes a second call for the same PR a no-op.
		const rows = db
			.select({
				id: memoryPlaybooks.id,
				status: memoryPlaybooks.status,
				gotcha: memoryPlaybooks.gotcha,
				provenanceJson: memoryPlaybooks.provenanceJson,
			})
			.from(memoryPlaybooks)
			.where(
				and(
					eq(memoryPlaybooks.projectId, projectId),
					eq(memoryPlaybooks.status, "provisional"),
				),
			)
			.all() as PlaybookRow[];

		const matched = rows.filter(
			(row) => parsePrNumber(row.provenanceJson) === prNumber,
		);
		if (matched.length === 0) return result;

		for (const row of matched) {
			if (terminalState === "merged") {
				db.update(memoryPlaybooks)
					.set({
						status: "confirmed",
						confidence: CONFIRM_CONFIDENCE,
						updatedAt: now,
					})
					.where(eq(memoryPlaybooks.id, row.id))
					.run();
				result.confirmed.push(row.id);
			} else {
				// Closed unmerged: demote + flag as an anti-pattern (best-effort).
				db.update(memoryPlaybooks)
					.set({
						status: "demoted",
						confidence: 0,
						gotcha: markAntiPattern(row.gotcha),
						updatedAt: now,
					})
					.where(eq(memoryPlaybooks.id, row.id))
					.run();
				result.demoted.push(row.id);
			}
		}
	} catch (error) {
		console.warn(
			"[host-service:pr-capture-reconciler] failed to reconcile playbooks",
			{ projectId, prNumber, terminalState, error },
		);
	}
	return result;
}

/**
 * Prepend the anti-pattern marker to a Playbook's gotcha (idempotent — never
 * double-prefixes). A closed-unmerged change is, by the merge signal, something
 * to avoid; flagging it keeps the negative example queryable.
 */
function markAntiPattern(gotcha: string | null): string {
	if (gotcha?.startsWith(ANTI_PATTERN_PREFIX)) return gotcha;
	const reason = "PR closed without merging";
	return gotcha
		? `${ANTI_PATTERN_PREFIX} ${reason}: ${gotcha}`
		: `${ANTI_PATTERN_PREFIX} ${reason}`;
}
