import { describe, expect, it } from "bun:test";
import type { Playbook } from "../types";
import { playbookNoteFilename, renderPlaybookNote, slugify } from "./vault";

function pb(overrides: Partial<Playbook> = {}): Playbook {
	// Spread overrides LAST so explicit `null`s (e.g. gotcha: null) win over the
	// defaults — a `??` merge would treat null as "use default".
	return {
		id: "11111111-2222-3333-4444-555555555555",
		projectId: "proj-1",
		intent: "Wire memory capture into the PR flow",
		touchedPaths: ["packages/host-service/src/app.ts", "apps/web/src/x.ts"],
		areaTags: ["backend", "frontend"],
		commands: ["bun test"],
		gotcha: "watch the lock",
		diffShape: "2 files (1 added, 1 modified)",
		validation: "suite green",
		status: "confirmed",
		confidence: 80,
		provenance: { prNumber: 42, url: null, taskId: null },
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("slugify", () => {
	it("lowercases, replaces non-alphanumerics, trims dashes", () => {
		expect(slugify("Wire Memory Capture!")).toBe("wire-memory-capture");
		expect(slugify("   ")).toBe("untitled");
	});
});

describe("playbookNoteFilename", () => {
	it("is stable: same playbook → same filename", () => {
		const p = pb();
		expect(playbookNoteFilename(p)).toBe(playbookNoteFilename(p));
		expect(playbookNoteFilename(p)).toBe(
			"wire-memory-capture-into-the-pr-flow-11111111.md",
		);
	});

	it("disambiguates same-intent playbooks by id suffix", () => {
		const a = pb({ id: "aaaaaaaa-0000-0000-0000-000000000000" });
		const b = pb({ id: "bbbbbbbb-0000-0000-0000-000000000000" });
		expect(playbookNoteFilename(a)).not.toBe(playbookNoteFilename(b));
	});
});

describe("renderPlaybookNote", () => {
	it("renders wikilinks to files, areas, similar playbooks, and practice", () => {
		const note = renderPlaybookNote({
			playbook: pb(),
			similar: [{ filename: "other-abcd1234.md", intent: "Other task" }],
			practices: ["project", "global"],
		});
		// File wikilinks with a basename alias.
		expect(note).toContain("[[packages/host-service/src/app.ts|app.ts]]");
		// Area wikilinks.
		expect(note).toContain("[[area-backend]]");
		expect(note).toContain("[[area-frontend]]");
		// Similar-playbook wikilink (extension stripped).
		expect(note).toContain("[[other-abcd1234|Other task]]");
		// Practice wikilinks.
		expect(note).toContain("[[practice-project|project coding practice]]");
		expect(note).toContain("[[practice-global|global coding practice]]");
		// Metadata + captured fields.
		expect(note).toContain("**Status:** confirmed");
		expect(note).toContain("**PR:** #42");
		expect(note).toContain("watch the lock");
	});

	it("is deterministic (regeneration yields identical bytes)", () => {
		const input = {
			playbook: pb(),
			similar: [],
			practices: [] as ("project" | "global")[],
		};
		expect(renderPlaybookNote(input)).toBe(renderPlaybookNote(input));
	});

	it("omits empty sections", () => {
		const note = renderPlaybookNote({
			playbook: pb({
				touchedPaths: [],
				commands: [],
				gotcha: null,
				diffShape: null,
				validation: null,
			}),
			similar: [],
			practices: [],
		});
		expect(note).not.toContain("## Files");
		expect(note).not.toContain("## Commands");
		expect(note).not.toContain("## Gotcha");
	});
});
