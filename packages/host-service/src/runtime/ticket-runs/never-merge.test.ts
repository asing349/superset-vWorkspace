import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * B5 HARD GUARDRAIL: the orchestrator is autonomous to PR CREATION ONLY and must
 * NEVER merge. This test greps the orchestrator's OWN source for any merge
 * invocation — the emitted instructions/commands must contain no `gh pr merge`,
 * no `--merge`, and no auto-merge enabling anywhere. (The prompt MENTIONS these
 * only to FORBID them; this test allows those negated mentions in the prompt
 * template while banning real invocations in the orchestrator's control flow.)
 */

const HERE = import.meta.dir;

// The orchestrator's control-flow source (NOT the prompt template, which names
// the forbidden commands in order to forbid them).
const CONTROL_FLOW_SOURCES = [
	resolve(HERE, "dispatch.ts"),
	resolve(HERE, "../../trpc/router/ticket-run/ticket-run.ts"),
];

// Any of these appearing in the control-flow source would be a real merge path.
const BANNED_PATTERNS = [
	"gh pr merge",
	"pr merge",
	"--merge",
	"--auto", // gh pr merge --auto (auto-merge)
	"mergePullRequest",
	"enableAutoMerge",
	"merge_method",
	"squashAndMerge",
];

describe("ticket→PR orchestrator never merges (B5 guardrail)", () => {
	it("orchestrator control-flow source contains NO merge invocation", () => {
		for (const file of CONTROL_FLOW_SOURCES) {
			const source = readFileSync(file, "utf8");
			for (const pattern of BANNED_PATTERNS) {
				expect(source.includes(pattern)).toBe(false);
			}
		}
	});

	it("the prompt template only NEGATES merge (forbids, never invokes)", () => {
		const template = readFileSync(resolve(HERE, "assemble-prompt.ts"), "utf8");
		// It names `gh pr merge` solely inside the never-merge instruction.
		expect(template).toContain("never run `gh pr merge`");
		expect(template).toContain("never enable auto-merge");
		// Every mention of "gh pr merge" is the NEGATED "never run `gh pr merge`"
		// form — there is no bare/affirmative merge invocation in the template.
		const ghMergeMentions = template.split("gh pr merge").length - 1;
		const negatedMentions =
			template.split("never run `gh pr merge`").length - 1;
		expect(ghMergeMentions).toBe(negatedMentions);
		// And it never constructs a templated merge command.
		expect(template).not.toContain("gh pr merge --");
	});
});
