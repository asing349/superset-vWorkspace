import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { projects } from "../../db/schema.ts";
import {
	type GenerateMemorySkillResult,
	generateMemorySkill,
} from "./push-generator.ts";

/**
 * Keep the generated `.agents/skills/superset-memory/SKILL.md` push surface
 * current (Superset Memory B4 push delivery → wave-4 A1(b)).
 *
 * `generateMemorySkill({ repoRoot })` writes the skill under
 * `<repoRoot>/.agents/skills/superset-memory/SKILL.md`. The committed skill
 * lives at the Superset monorepo root, which — when a developer runs Superset on
 * a repo — is exactly that project's `repoPath`. We resolve `repoRoot` the same
 * way the B5 consolidation service resolves its project-practice target
 * (`<project.repoPath>/AGENTS.md`): from the host `projects` table. So the skill
 * lands in the same repo the agent reads its `.agents/skills/` and `AGENTS.md`
 * from. This is the only correct, abstraction-backed source of a repo root the
 * host knows about — there is no monorepo-root value in `CreateAppOptions`.
 *
 * The write is idempotent (overwrites the single generated file in place), so
 * regenerating on every memory mutation and on startup is safe and cheap.
 */

/** Regenerate the memory skill for one project. Returns null if unknown/failed. */
export function regenerateMemorySkillForProject(options: {
	db: HostDb;
	projectId: string;
}): GenerateMemorySkillResult | null {
	const { db, projectId } = options;
	try {
		const project = db.query.projects
			.findFirst({ where: eq(projects.id, projectId) })
			.sync();
		if (!project?.repoPath) return null;
		return generateMemorySkill({ repoRoot: project.repoPath });
	} catch (error) {
		// Best-effort: a stale skill must never fail a capture/consolidation.
		console.warn(
			"[host-service:memory] failed to regenerate memory skill for project",
			{ projectId, error },
		);
		return null;
	}
}

/**
 * Regenerate the memory skill for every known project. Runs on startup so the
 * generated SKILL.md is fresh the moment the host comes up. Best-effort and
 * idempotent; a failure on one project does not skip the others.
 */
export function regenerateMemorySkillsForAllProjects(options: {
	db: HostDb;
}): GenerateMemorySkillResult[] {
	const { db } = options;
	const written: GenerateMemorySkillResult[] = [];
	let rows: { id: string }[] = [];
	try {
		rows = db.select({ id: projects.id }).from(projects).all();
	} catch (error) {
		console.warn(
			"[host-service:memory] failed to list projects for skill regen",
			{ error },
		);
		return written;
	}
	for (const row of rows) {
		const result = regenerateMemorySkillForProject({ db, projectId: row.id });
		if (result) written.push(result);
	}
	return written;
}
