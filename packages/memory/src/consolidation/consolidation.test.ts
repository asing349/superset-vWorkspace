import { describe, expect, it } from "bun:test";
import type { Playbook } from "../types";
import {
	applyManagedBlock,
	consolidatePlaybooks,
	extractManagedBlock,
	MANAGED_BLOCK_END,
	MANAGED_BLOCK_START,
	renderPracticeMarkdown,
	stripManagedBlock,
} from "./consolidation";

function pb(overrides: Partial<Playbook> = {}): Playbook {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		projectId: overrides.projectId ?? "proj-1",
		intent: overrides.intent ?? "Add a thing",
		touchedPaths: overrides.touchedPaths ?? ["apps/web/src/x.ts"],
		areaTags: overrides.areaTags ?? ["frontend"],
		commands: overrides.commands ?? [],
		gotcha: overrides.gotcha ?? null,
		diffShape: overrides.diffShape ?? null,
		validation: overrides.validation ?? null,
		status: overrides.status ?? "confirmed",
		confidence: overrides.confidence ?? 80,
		provenance: overrides.provenance ?? {
			prNumber: null,
			url: null,
			taskId: null,
		},
		createdAt: overrides.createdAt ?? 1,
		updatedAt: overrides.updatedAt ?? 1,
	};
}

describe("consolidatePlaybooks — heuristic", () => {
	it("only consolidates confirmed playbooks", () => {
		const proposal = consolidatePlaybooks({
			scope: "project",
			playbooks: [
				pb({ intent: "Confirmed rule", status: "confirmed" }),
				pb({ intent: "Provisional rule", status: "provisional" }),
				pb({ intent: "Demoted rule", status: "demoted" }),
			],
		});
		expect(proposal.sourceCount).toBe(1);
		expect(proposal.rules.map((r) => r.text)).toEqual(["Confirmed rule"]);
	});

	it("merges/dedupes identical intents and counts support", () => {
		const proposal = consolidatePlaybooks({
			scope: "project",
			playbooks: [
				pb({
					intent: "Wire the thing",
					provenance: { prNumber: 1, url: null, taskId: null },
				}),
				pb({
					intent: "wire the thing",
					provenance: { prNumber: 2, url: null, taskId: null },
				}),
			],
		});
		expect(proposal.rules).toHaveLength(1);
		expect(proposal.rules[0]?.support).toBe(2);
		expect(proposal.rules[0]?.prNumbers).toEqual([1, 2]);
	});

	it("prunes clusters below the confidence floor", () => {
		const proposal = consolidatePlaybooks({
			scope: "project",
			minConfidence: 50,
			playbooks: [
				pb({ intent: "Strong rule", confidence: 90 }),
				pb({ intent: "Weak rule", confidence: 20 }),
			],
		});
		expect(proposal.rules.map((r) => r.text)).toEqual(["Strong rule"]);
	});

	it("global scope only promotes patterns recurring across distinct projects", () => {
		const playbooks = [
			pb({ intent: "Cross-repo pattern", projectId: "proj-1" }),
			pb({ intent: "cross-repo pattern", projectId: "proj-2" }),
			pb({ intent: "Single-repo pattern", projectId: "proj-1" }),
		];
		const global = consolidatePlaybooks({ scope: "global", playbooks });
		expect(global.rules.map((r) => r.text)).toEqual(["Cross-repo pattern"]);
		expect(global.rules[0]?.projectCount).toBe(2);

		// Project scope keeps both (no cross-repo requirement).
		const project = consolidatePlaybooks({ scope: "project", playbooks });
		expect(project.rules.map((r) => r.text).sort()).toEqual([
			"Cross-repo pattern",
			"Single-repo pattern",
		]);
	});

	it("caps rules per area, keeping the highest-support ones", () => {
		const playbooks = [
			pb({ intent: "A", areaTags: ["backend"], confidence: 80 }),
			pb({ intent: "A", areaTags: ["backend"], confidence: 80 }), // support 2
			pb({ intent: "B", areaTags: ["backend"], confidence: 80 }),
			pb({ intent: "C", areaTags: ["backend"], confidence: 80 }),
		];
		const proposal = consolidatePlaybooks({
			scope: "project",
			maxRulesPerArea: 2,
			playbooks,
		});
		const backend = proposal.rules.filter((r) => r.area === "backend");
		expect(backend).toHaveLength(2);
		// "A" has support 2 so it must survive the cap.
		expect(backend.map((r) => r.text)).toContain("A");
	});
});

describe("renderPracticeMarkdown", () => {
	it("renders area sections with provenance and is idempotent", () => {
		const proposal = consolidatePlaybooks({
			scope: "project",
			playbooks: [
				pb({
					intent: "Use object params",
					areaTags: ["backend"],
					provenance: { prNumber: 12, url: null, taskId: null },
				}),
			],
		});
		const md1 = renderPracticeMarkdown(proposal);
		const md2 = renderPracticeMarkdown(proposal);
		expect(md1).toBe(md2); // deterministic
		expect(md1).toContain("### Backend");
		expect(md1).toContain("- Use object params (#12)");
		expect(md1).toContain("Coding practice");
	});

	it("renders an explicit empty state when nothing qualifies", () => {
		const proposal = consolidatePlaybooks({ scope: "project", playbooks: [] });
		expect(renderPracticeMarkdown(proposal)).toContain(
			"No confirmed playbooks yet",
		);
	});
});

describe("managed block — idempotent + non-clobbering", () => {
	it("appends a block to hand-written content without touching it", () => {
		const existing = "# AGENTS\n\nHand-written rules here.\n";
		const result = applyManagedBlock({ existing, content: "managed body" });
		expect(result).toContain("Hand-written rules here.");
		expect(result).toContain(MANAGED_BLOCK_START);
		expect(result).toContain("managed body");
		expect(result).toContain(MANAGED_BLOCK_END);
	});

	it("replaces only the block content on re-apply (idempotent)", () => {
		const existing = "# Doc\n\nKeep me.\n";
		const once = applyManagedBlock({ existing, content: "v1" });
		const twice = applyManagedBlock({ existing: once, content: "v2" });
		// Hand-written content preserved, exactly one block, new content.
		expect(twice).toContain("Keep me.");
		expect(twice.match(/superset-memory:start/g)).toHaveLength(1);
		expect(twice).toContain("v2");
		expect(twice).not.toContain("v1");
	});

	it("round-trips via extractManagedBlock", () => {
		const file = applyManagedBlock({
			existing: "intro\n",
			content: "line one\nline two",
		});
		expect(extractManagedBlock(file)).toBe("line one\nline two");
		expect(extractManagedBlock("no block here")).toBeNull();
	});

	it("strips the block and restores hand-written content", () => {
		const existing = "# Doc\n\nKeep me.\n";
		const withBlock = applyManagedBlock({ existing, content: "managed" });
		const stripped = stripManagedBlock(withBlock);
		expect(stripped).toContain("Keep me.");
		expect(stripped).not.toContain("superset-memory");
	});

	it("seeds an empty file cleanly", () => {
		const result = applyManagedBlock({ existing: "", content: "body" });
		expect(result.startsWith(MANAGED_BLOCK_START)).toBe(true);
		expect(extractManagedBlock(result)).toBe("body");
	});
});
