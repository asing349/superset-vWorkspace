import { describe, expect, it } from "bun:test";
import {
	buildReviewerContextSnapshot,
	computeSettingsHash,
	DEFAULT_REVIEWER_GROUNDING_LAYERS,
	diffReviewerContext,
	normalizeGroundingLayers,
	type ReviewerContextInputs,
} from "./reviewer-context.ts";

const BASE: ReviewerContextInputs = {
	groundingLayers: [...DEFAULT_REVIEWER_GROUNDING_LAYERS],
	practiceProjectVersionId: "pp-1",
	practiceProjectVersion: 1,
	practiceGlobalVersionId: "gp-1",
	practiceGlobalVersion: 1,
	indexCommitSha: "abc123",
	indexLastIndexedAt: 1000,
	indexEntryCount: 42,
};

describe("reviewer-context (M5 change detection)", () => {
	it("snapshot hashing is deterministic for identical inputs", () => {
		const a = buildReviewerContextSnapshot(BASE);
		const b = buildReviewerContextSnapshot({ ...BASE });
		expect(a.contextHash).toBe(b.contextHash);
		expect(a.settingsHash).toBe(b.settingsHash);
		expect(a.contextHash.length).toBeGreaterThan(0);
	});

	it("settings hash is order-independent over grounding layers", () => {
		const forward = computeSettingsHash({
			groundingLayers: ["practice-project", "project-index", "playbooks"],
		});
		const shuffled = computeSettingsHash({
			groundingLayers: ["playbooks", "practice-project", "project-index"],
		});
		expect(forward).toBe(shuffled);
		expect(normalizeGroundingLayers(["b", "a", "a"])).toEqual(["a", "b"]);
	});

	it("identical current vs snapshot ⇒ not changed, no changes", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({ snapshot, current: { ...BASE } });
		expect(diff.changed).toBe(false);
		expect(diff.changes).toHaveLength(0);
	});

	it("a new project-practice version ⇒ changed + practice-project change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: {
				...BASE,
				practiceProjectVersionId: "pp-2",
				practiceProjectVersion: 2,
			},
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain("practice-project");
		const change = diff.changes.find((c) => c.kind === "practice-project");
		expect(change?.detail).toContain("v1");
		expect(change?.detail).toContain("v2");
	});

	it("a new global-practice version ⇒ changed + practice-global change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: {
				...BASE,
				practiceGlobalVersionId: "gp-2",
				practiceGlobalVersion: 2,
			},
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain("practice-global");
	});

	it("a new index commit sha ⇒ changed + project-index change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, indexCommitSha: "def456" },
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain("project-index");
	});

	it("a changed index entry count ⇒ changed + project-index change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, indexEntryCount: 43 },
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain("project-index");
	});

	it("changed grounding layers ⇒ changed + settings change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, groundingLayers: ["practice-project"] },
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain("settings");
	});

	it("a changed business-rules signature ⇒ changed + observed-business-rules change (M6)", () => {
		const snapshot = buildReviewerContextSnapshot({
			...BASE,
			businessRulesSignature: "sig-1",
		});
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, businessRulesSignature: "sig-2" },
		});
		expect(diff.changed).toBe(true);
		expect(diff.changes.map((c) => c.kind)).toContain(
			"observed-business-rules",
		);
	});

	it("an absent business-rules signature is treated as empty (not a change)", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, businessRulesSignature: "" },
		});
		expect(diff.changed).toBe(false);
		expect(diff.changes).toHaveLength(0);
	});

	it("reordering grounding layers alone is NOT a change", () => {
		const snapshot = buildReviewerContextSnapshot(BASE);
		const reordered = [...BASE.groundingLayers].reverse();
		const diff = diffReviewerContext({
			snapshot,
			current: { ...BASE, groundingLayers: reordered },
		});
		expect(diff.changed).toBe(false);
		expect(diff.changes).toHaveLength(0);
	});
});
