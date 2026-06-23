import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Push-delivery generator (B4, Claude-native). Emits the memory "push" surface:
 * a generated skill that tells an agent how to PULL from the local memory MCP
 * server and where retrieved practice/playbooks live. Additive, local, and
 * idempotent — regenerating overwrites the single generated file in place and
 * never touches anything else. The MCP pull path is the priority; this is the
 * lightweight discovery hint that points agents at it.
 */

const SKILL_RELATIVE_PATH = ".agents/skills/superset-memory/SKILL.md";

/** The generated skill body. Pure (no I/O) so it can be unit-tested directly. */
export function renderMemorySkill(): string {
	return `---
name: superset-memory
description: Pull reusable knowledge from Superset Memory (local) before starting a task — prior playbooks, this repo's coding practice, and a project-index map — so you explore less and repeat the established conventions. Use BEFORE exploring the codebase on any non-trivial task.
---

# Superset Memory (local, self-improving)

Superset keeps a **local** memory of how past tasks were done in this repo and
feeds the relevant slice back to you. It is exposed over a local MCP server
named \`superset-memory\` (no network — everything stays on this machine).

## When to use

At the **start** of any non-trivial task, before grepping/exploring: pull the
bundle for what you're about to do. It returns (1) this repo's **coding
practice**, (2) the **top-k playbooks** (distilled records of similar past
tasks: intent, commands that worked, the gotcha avoided, the diff shape), and
(3) **project-index slices** (where things live + exported symbols), filtered to
the areas your task touches and capped to a token budget.

## How to pull (MCP tools on the \`superset-memory\` server)

- \`memory_search\` — the main entrypoint. Input: \`{ intent, projectId?, areaTags?,
  topKPlaybooks?, topKIndexSlices?, maxTokens?, includeProvisional? }\`. Returns
  \`{ queryAreas, practices[], playbooks[], indexSlices[], estimatedTokens, trimmed }\`.
- \`memory_get_playbook\` — \`{ id }\` → one playbook's full detail (touched paths,
  commands, validation).
- \`memory_get_practice\` — \`{ scope: "project" | "global", projectId? }\` → the
  latest durable coding-practice doc for that scope.

## What to do with it

1. **Follow the practice** returned by \`memory_get_practice\` / the \`practices\`
   field — these are this repo's (and your) durable conventions.
2. **Reuse the playbooks** — if a returned playbook matches your task, follow its
   commands and avoid its gotcha instead of rediscovering them.
3. **Jump to the index slices** — use the \`indexSlices\` paths/summaries to go
   straight to the right files instead of searching.

Memory is consolidated by the user at PR time and via the "update coding
practice" button; you only ever **read** it here.
`;
}

export interface GenerateMemorySkillResult {
	path: string;
	bytesWritten: number;
}

/**
 * Write the generated memory skill under \`repoRoot/.agents/skills/...\`.
 * Idempotent: creates the directory if needed and overwrites the file. Returns
 * the absolute path written.
 */
export function generateMemorySkill(options: {
	repoRoot: string;
}): GenerateMemorySkillResult {
	const path = join(options.repoRoot, SKILL_RELATIVE_PATH);
	mkdirSync(dirname(path), { recursive: true });
	const content = renderMemorySkill();
	writeFileSync(path, content, "utf8");
	return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
}

export { SKILL_RELATIVE_PATH as MEMORY_SKILL_RELATIVE_PATH };
