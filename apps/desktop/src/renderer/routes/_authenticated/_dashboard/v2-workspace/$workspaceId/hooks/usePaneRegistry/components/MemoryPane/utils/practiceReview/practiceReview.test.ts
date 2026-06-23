import { describe, expect, it } from "bun:test";
import {
	acceptSummary,
	type ConsolidationProposal,
	canAccept,
	canRevert,
	contentToAccept,
	proposalHasChanges,
} from "./practiceReview";

function proposal(
	overrides: Partial<ConsolidationProposal> = {},
): ConsolidationProposal {
	return {
		scope: "project",
		projectId: "proj-1",
		currentDoc: "current",
		proposedDoc: "proposed",
		diff: { lines: [], added: 1, removed: 0 },
		provenance: "from PR #1",
		sourceCount: 2,
		targetPath: "/repo/AGENTS.md",
		...overrides,
	};
}

describe("canAccept", () => {
	it("is false with no proposal", () => {
		expect(canAccept({ proposal: null, editedContent: "x" })).toBe(false);
	});

	it("is false when edited content equals the current doc", () => {
		expect(
			canAccept({
				proposal: proposal({ currentDoc: "same" }),
				editedContent: "same",
			}),
		).toBe(false);
	});

	it("is true when content differs from current", () => {
		expect(
			canAccept({
				proposal: proposal({ currentDoc: "old" }),
				editedContent: "new",
			}),
		).toBe(true);
	});
});

describe("canRevert", () => {
	it("requires a prior version (history >= 2)", () => {
		expect(canRevert(0)).toBe(false);
		expect(canRevert(1)).toBe(false);
		expect(canRevert(2)).toBe(true);
		expect(canRevert(5)).toBe(true);
	});
});

describe("contentToAccept", () => {
	it("prefers edited content, falls back to the proposed doc", () => {
		const p = proposal();
		expect(contentToAccept({ proposal: p, editedContent: "edited" })).toBe(
			"edited",
		);
		expect(contentToAccept({ proposal: p, editedContent: null })).toBe(
			"proposed",
		);
	});
});

describe("acceptSummary", () => {
	it("describes a project update with pluralization", () => {
		expect(acceptSummary(proposal({ scope: "project", sourceCount: 2 }))).toBe(
			"Update this project's coding practice from 2 confirmed playbooks.",
		);
		expect(acceptSummary(proposal({ scope: "global", sourceCount: 1 }))).toBe(
			"Update global coding practice from 1 confirmed playbook.",
		);
	});
});

describe("proposalHasChanges", () => {
	it("is true when the diff adds or removes lines", () => {
		expect(
			proposalHasChanges(
				proposal({ diff: { lines: [], added: 0, removed: 0 } }),
			),
		).toBe(false);
		expect(
			proposalHasChanges(
				proposal({ diff: { lines: [], added: 3, removed: 0 } }),
			),
		).toBe(true);
		expect(
			proposalHasChanges(
				proposal({ diff: { lines: [], added: 0, removed: 2 } }),
			),
		).toBe(true);
	});
});
