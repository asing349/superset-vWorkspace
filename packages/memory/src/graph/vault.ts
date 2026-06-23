import type { Playbook } from "../types";
import { basename } from "./graph";

/**
 * Obsidian vault note rendering (PURE LOGIC, B6). Render one Markdown note per
 * Playbook with `[[wikilinks]]` to its files, areas, similar playbooks, and the
 * practice docs. Plain Markdown — Obsidian-compatible but not required. The host
 * writes these to `~/.superset/memory/vault/`; this module only produces the
 * deterministic filename + content so it is unit-testable and regenerable.
 */

/** Slugify an intent into a stable, filesystem-safe note name. */
export function slugify(text: string): string {
	const base = text
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return base.length > 0 ? base : "untitled";
}

/**
 * Deterministic note filename for a playbook: `<slug>-<id8>.md`. The short id
 * suffix guarantees uniqueness across playbooks with the same intent and keeps
 * regeneration stable (same playbook → same filename).
 */
export function playbookNoteFilename(
	playbook: Pick<Playbook, "id" | "intent">,
): string {
	const id8 = playbook.id.replace(/-/g, "").slice(0, 8);
	return `${slugify(playbook.intent)}-${id8}.md`;
}

/** A wikilink target derived from a note filename (no extension). */
function noteLinkTarget(filename: string): string {
	return filename.replace(/\.md$/, "");
}

export interface RenderNoteInput {
	playbook: Playbook;
	/** Other playbooks deemed similar (already filtered + sorted by the host). */
	similar: ReadonlyArray<{ filename: string; intent: string }>;
	/** Practice scopes that exist (link targets). */
	practices: ReadonlyArray<"project" | "global">;
}

/**
 * Render a playbook's vault note. Deterministic: the same input yields
 * byte-identical output (so regeneration is a no-op when nothing changed).
 */
export function renderPlaybookNote(input: RenderNoteInput): string {
	const { playbook, similar, practices } = input;
	const lines: string[] = [];

	lines.push(`# ${playbook.intent}`, "");

	// Frontmatter-ish metadata block (plain, not YAML, to stay dependency-free).
	lines.push(`- **Status:** ${playbook.status}`);
	lines.push(`- **Confidence:** ${playbook.confidence}`);
	if (playbook.provenance.prNumber !== null) {
		lines.push(`- **PR:** #${playbook.provenance.prNumber}`);
	}
	lines.push("");

	if (playbook.areaTags.length > 0) {
		const tags = [...new Set(playbook.areaTags)]
			.sort()
			.map((area) => `[[area-${area}]]`)
			.join(" ");
		lines.push(`**Areas:** ${tags}`, "");
	}

	if (playbook.touchedPaths.length > 0) {
		lines.push("## Files");
		for (const path of [...new Set(playbook.touchedPaths)].sort()) {
			lines.push(`- [[${path}|${basename(path)}]]`);
		}
		lines.push("");
	}

	if (playbook.diffShape) {
		lines.push("## Diff shape", "", playbook.diffShape, "");
	}
	if (playbook.commands.length > 0) {
		lines.push("## Commands", "");
		for (const command of playbook.commands) lines.push(`- \`${command}\``);
		lines.push("");
	}
	if (playbook.gotcha) {
		lines.push("## Gotcha", "", playbook.gotcha, "");
	}
	if (playbook.validation) {
		lines.push("## Validation", "", playbook.validation, "");
	}

	if (similar.length > 0) {
		lines.push("## Similar playbooks");
		for (const s of similar) {
			lines.push(`- [[${noteLinkTarget(s.filename)}|${s.intent}]]`);
		}
		lines.push("");
	}

	if (practices.length > 0) {
		lines.push("## Practice");
		for (const scope of practices) {
			lines.push(`- [[practice-${scope}|${scope} coding practice]]`);
		}
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
