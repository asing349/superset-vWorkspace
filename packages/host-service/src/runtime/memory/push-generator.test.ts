import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	generateMemorySkill,
	MEMORY_SKILL_RELATIVE_PATH,
	renderMemorySkill,
} from "./push-generator.ts";

describe("memory push generator (B4)", () => {
	it("renders a skill with frontmatter and the MCP tool names", () => {
		const skill = renderMemorySkill();
		expect(skill).toContain("name: superset-memory");
		expect(skill).toContain("memory_search");
		expect(skill).toContain("memory_get_playbook");
		expect(skill).toContain("memory_get_practice");
	});

	it("writes the skill under .agents/skills and is idempotent", () => {
		const root = mkdtempSync(join(tmpdir(), "memory-skill-"));
		try {
			const first = generateMemorySkill({ repoRoot: root });
			expect(first.path).toBe(join(root, MEMORY_SKILL_RELATIVE_PATH));
			const content1 = readFileSync(first.path, "utf8");

			// Regenerating overwrites in place with identical content.
			const second = generateMemorySkill({ repoRoot: root });
			const content2 = readFileSync(second.path, "utf8");
			expect(content2).toBe(content1);
			expect(second.path).toBe(first.path);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
