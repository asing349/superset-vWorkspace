import { redactText } from "@superset/memory";

/**
 * Ticket→PR prompt assembly (B5) — PURE, no I/O, so the guardrails (layer ORDER,
 * redaction, the never-merge stop instruction) are directly unit-testable.
 *
 * Context precedence is MOST-POWERFUL-LAST and explicitly marked: the layered
 * prompt is ordered (1) global Coding Practice, (2) project Coding Practice,
 * (3) the developer-APPROVED ticket context — the authoritative top layer. The
 * whole assembled prompt is then redacted (redaction point #2).
 *
 * HARD GUARDRAIL: the run is autonomous to PR CREATION ONLY. The closing
 * instruction forbids merging in every form; the orchestrator itself never
 * invokes a merge tool.
 */

/** The literal stop instruction. Exported so a test can assert it verbatim. */
export const NEVER_MERGE_INSTRUCTION =
	"Implement the change. Then commit, push, and run `/pr/create-pr` to open the pull request. STOP once the PR is open. Do NOT merge — never run `gh pr merge`, never enable auto-merge; the run ends at PR creation.";

export interface AssembleTicketPromptInput {
	/** The ticket key (e.g. "SUPER-172"), carried into the branch/PR for B6. */
	ticketKey: string;
	/** Global Coding Practice doc content, when present (least powerful). */
	globalPractice: string | null;
	/** Project Coding Practice doc content for this repo, when present. */
	projectPractice: string | null;
	/** The developer-APPROVED ticket context — authoritative, top precedence. */
	approvedContext: string;
}

/**
 * Assemble the layered, redacted prompt. The approved context is placed LAST
 * (after project practice, after global practice) and wrapped in an explicitly
 * AUTHORITATIVE block, so the model treats it as overriding the practice layers.
 */
export function assembleTicketPrompt(input: AssembleTicketPromptInput): string {
	const sections: string[] = [];

	sections.push(
		[
			`# Autonomous task for ticket ${input.ticketKey}`,
			"",
			"You are completing a developer-approved ticket end-to-end. The context",
			"below is layered by precedence: later layers OVERRIDE earlier ones. The",
			"final, AUTHORITATIVE layer is the developer-approved ticket context.",
		].join("\n"),
	);

	// (1) Global Coding Practice — least powerful.
	if (input.globalPractice && input.globalPractice.trim().length > 0) {
		sections.push(
			[
				"## Layer 1 — Global Coding Practice (baseline conventions)",
				"",
				input.globalPractice.trim(),
			].join("\n"),
		);
	}

	// (2) Project Coding Practice — overrides global.
	if (input.projectPractice && input.projectPractice.trim().length > 0) {
		sections.push(
			[
				"## Layer 2 — Project Coding Practice (overrides global)",
				"",
				input.projectPractice.trim(),
			].join("\n"),
		);
	}

	// (3) Developer-approved ticket context — AUTHORITATIVE, top precedence, LAST.
	sections.push(
		[
			"## Layer 3 — Developer-approved ticket context (AUTHORITATIVE — highest precedence)",
			"",
			"This is the authoritative instruction set. Where it conflicts with the",
			"practice layers above, THIS layer wins.",
			"",
			input.approvedContext.trim(),
		].join("\n"),
	);

	// Closing stop instruction — autonomous to PR creation, NEVER merge.
	sections.push(["## What to do", "", NEVER_MERGE_INSTRUCTION].join("\n"));

	const assembled = sections.join("\n\n");

	// Redaction point #2: scrub the WHOLE assembled prompt (every layer) before
	// it is handed to the agent / stored. Best-effort secret-scrub.
	return redactText(assembled).text;
}
