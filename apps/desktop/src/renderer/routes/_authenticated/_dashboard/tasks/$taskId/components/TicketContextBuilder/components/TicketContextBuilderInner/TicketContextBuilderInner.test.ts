import { describe, expect, test } from "bun:test";
// biome-ignore lint/style/noRestrictedImports: test reads source to assert wiring
import { readFileSync } from "node:fs";
// biome-ignore lint/style/noRestrictedImports: test reads source to assert wiring
import { join } from "node:path";

/**
 * Source-level regression tests for B3-renderer (the single human gate) and the
 * B2 coupling fix the coordinator flagged: regeneration must NOT silently
 * clobber the developer's edits, and approval must persist the EDITED content.
 *
 * Full render tests would need the workspaceTrpc + host-service providers; the
 * repo's TasksView tests use the same source-assertion approach.
 */

const DIR = __dirname;

function read(relativePath: string): string {
	return readFileSync(join(DIR, relativePath), "utf-8");
}

describe("TicketContextBuilderInner — edit/approve gate (B3)", () => {
	const source = read("TicketContextBuilderInner.tsx");

	test("separates the editable working copy from the generated draft", () => {
		// The developer's edits live in their own state, not re-derived each render.
		expect(source).toContain("editableContent");
		expect(source).toContain("setEditableContent");
	});

	test("the editor captures edits via onChange into editableContent", () => {
		expect(source).toContain("onChange={handleEditorChange}");
		expect(source).toContain("setEditableContent(markdown)");
	});

	test("regeneration is gated behind an explicit, warned action (no silent clobber)", () => {
		// developerInput is NOT a dep of the draft-assembly effect — typing in the
		// context box can never rebuild the draft. Only `intent` (set by an explicit
		// generate/regenerate action) triggers assembly.
		expect(source).toContain("if (intent === null) return;");
		// Regenerating over existing content warns first.
		expect(source).toContain("Replace the current context?");
		expect(source).toContain("Regenerate");
	});

	test("approve persists the edited content via the shared approval hook", () => {
		expect(source).toContain("approval.approve({ content: editableContent })");
	});

	test("reopen shows the approved content (authoritative), not a fresh draft", () => {
		expect(source).toContain("approval.approvedContent");
		// When there is no working copy yet, load the approved content into it.
		expect(source).toContain("setContent(approval.approvedContent)");
	});
});

describe("TicketRunLauncher — run gated on approval (B3 -> B4)", () => {
	const source = read("../../../TicketRunLauncher/TicketRunLauncher.tsx");

	test("blocks the run until an approved context exists", () => {
		expect(source).toContain('return "Approve the context first";');
		// Blocks while the gate state is still unknown so we never start unguarded.
		expect(source).toContain("approval.isApprovalLoaded");
		expect(source).toContain("approval.approvedContent === null");
	});

	test("lifts the primary projectId so the gate and approval share a key", () => {
		expect(source).toContain("onPrimaryProjectChange");
	});
});
