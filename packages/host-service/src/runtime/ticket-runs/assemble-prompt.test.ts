import { describe, expect, it } from "bun:test";
import {
	assembleTicketPrompt,
	NEVER_MERGE_INSTRUCTION,
} from "./assemble-prompt.ts";

/**
 * B5 guardrails — these tests ENCODE the contract: the approved context is the
 * authoritative, most-powerful-LAST layer; the whole prompt is redacted; and
 * the run stops at PR creation (never merge).
 */
describe("assembleTicketPrompt (B5 layering + guardrails)", () => {
	const base = {
		ticketKey: "SUPER-172",
		globalPractice: "GLOBAL_PRACTICE_MARKER",
		projectPractice: "PROJECT_PRACTICE_MARKER",
		approvedContext: "APPROVED_CONTEXT_MARKER",
	};

	it("orders layers global < project < approved (most-powerful LAST)", () => {
		const prompt = assembleTicketPrompt(base);
		const iGlobal = prompt.indexOf("GLOBAL_PRACTICE_MARKER");
		const iProject = prompt.indexOf("PROJECT_PRACTICE_MARKER");
		const iApproved = prompt.indexOf("APPROVED_CONTEXT_MARKER");

		expect(iGlobal).toBeGreaterThanOrEqual(0);
		expect(iProject).toBeGreaterThanOrEqual(0);
		expect(iApproved).toBeGreaterThanOrEqual(0);
		// Global BEFORE project BEFORE approved.
		expect(iGlobal).toBeLessThan(iProject);
		expect(iProject).toBeLessThan(iApproved);
	});

	it("marks the approved-context layer AUTHORITATIVE / highest precedence", () => {
		const prompt = assembleTicketPrompt(base);
		const iApproved = prompt.indexOf("APPROVED_CONTEXT_MARKER");
		const authoritativeHeader = prompt.indexOf(
			"Developer-approved ticket context (AUTHORITATIVE",
		);
		expect(authoritativeHeader).toBeGreaterThanOrEqual(0);
		// The authoritative marker sits with the approved layer (the last layer).
		expect(authoritativeHeader).toBeLessThan(iApproved);
		expect(prompt).toContain("THIS layer wins");
	});

	it("carries the ticket key for branch/PR linking (B6)", () => {
		expect(assembleTicketPrompt(base)).toContain("SUPER-172");
	});

	it("ends with the never-merge stop instruction", () => {
		const prompt = assembleTicketPrompt(base);
		expect(prompt).toContain(NEVER_MERGE_INSTRUCTION);
		expect(prompt).toContain("STOP once the PR is open");
		expect(prompt).toContain("Do NOT merge");
		expect(prompt).toContain("never run `gh pr merge`");
		expect(prompt).toContain("never enable auto-merge");
	});

	it("redacts a secret planted in ANY layer (redaction point #2)", () => {
		const secret = `ghp_${"a".repeat(36)}`;
		for (const layer of [
			"globalPractice",
			"projectPractice",
			"approvedContext",
		] as const) {
			const prompt = assembleTicketPrompt({
				...base,
				[layer]: `leak ${secret} here`,
			});
			expect(prompt).not.toContain(secret);
			expect(prompt).toContain("[REDACTED]");
		}
	});

	it("omits empty practice layers but always includes the approved layer", () => {
		const prompt = assembleTicketPrompt({
			ticketKey: "SUPER-9",
			globalPractice: null,
			projectPractice: "   ",
			approvedContext: "ONLY_APPROVED",
		});
		expect(prompt).not.toContain("Layer 1 — Global Coding Practice");
		expect(prompt).not.toContain("Layer 2 — Project Coding Practice");
		expect(prompt).toContain("ONLY_APPROVED");
		expect(prompt).toContain(NEVER_MERGE_INSTRUCTION);
	});
});
