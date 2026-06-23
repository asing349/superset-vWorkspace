import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	applyManagedBlock,
	computeLineDiff,
	consolidatePlaybooks,
	extractManagedBlock,
	type LineDiff,
	type Playbook,
	type PlaybookProvenance,
	type PlaybookStatus,
	type PracticeProposal,
	type PracticeScope,
	type PracticeVersion,
	renderPracticeMarkdown,
} from "@superset/memory";
import { and, desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	projects,
} from "../../db/schema.ts";
import { getSupersetHomeDir } from "./paths.ts";

/**
 * Coding-Practice consolidation service (B5 host half). Turns confirmed
 * Playbooks into a proposed Practice doc (via the pure `@superset/memory`
 * heuristic — NO model, NO network), writes accepted docs into a clearly-
 * delimited managed block in the target file, and versions every write into
 * `memory_practice_versions` for a linear, revertible history.
 *
 * Targets:
 *   - project: the repo's `AGENTS.md` managed block (safest reversible option —
 *     never clobbers hand-written content; project rules override global per A6).
 *   - global:  `~/.superset/practice.md` (honors `SUPERSET_HOME_DIR`).
 */

/** A reviewable consolidation proposal returned to the renderer. */
export interface ConsolidationProposal {
	scope: PracticeScope;
	projectId: string | null;
	/** Current managed-doc content (the block body / file), "" when none. */
	currentDoc: string;
	/** Proposed managed-doc content (block body) to review. */
	proposedDoc: string;
	/** Line diff of current → proposed for the review UI. */
	diff: LineDiff;
	/** One-line provenance summary. */
	provenance: string;
	/** Count of confirmed playbooks that fed the proposal. */
	sourceCount: number;
	/** Absolute path of the file the accept would write to. */
	targetPath: string;
}

const ROW_TO_PLAYBOOK_STATUS = new Set<PlaybookStatus>([
	"provisional",
	"confirmed",
	"demoted",
	"archived",
]);

function parseStringArray(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

function parseProvenance(value: string): PlaybookProvenance {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		return {
			prNumber: typeof parsed.prNumber === "number" ? parsed.prNumber : null,
			url: typeof parsed.url === "string" ? parsed.url : null,
			taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
		};
	} catch {
		return { prNumber: null, url: null, taskId: null };
	}
}

function rowToPlaybook(row: typeof memoryPlaybooks.$inferSelect): Playbook {
	const status = ROW_TO_PLAYBOOK_STATUS.has(row.status as PlaybookStatus)
		? (row.status as PlaybookStatus)
		: "provisional";
	return {
		id: row.id,
		projectId: row.projectId,
		intent: row.intent,
		touchedPaths: parseStringArray(row.touchedPathsJson),
		// areaTags parsed loosely; the pure heuristic only reads the first tag.
		areaTags: parseStringArray(row.areaTagsJson) as Playbook["areaTags"],
		commands: parseStringArray(row.commandsJson),
		gotcha: row.gotcha,
		diffShape: row.diffShape,
		validation: row.validation,
		status,
		confidence: row.confidence,
		provenance: parseProvenance(row.provenanceJson),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export interface MemoryConsolidationServiceOptions {
	db: HostDb;
}

export class MemoryConsolidationService {
	private readonly db: HostDb;

	constructor(options: MemoryConsolidationServiceOptions) {
		this.db = options.db;
	}

	/**
	 * Resolve the absolute file the accept/revert writes to for a scope.
	 * - project: `<repoPath>/AGENTS.md`
	 * - global:  `<~/.superset>/practice.md`
	 */
	resolveTargetPath(options: {
		scope: PracticeScope;
		projectId: string | null;
	}): string {
		if (options.scope === "global") {
			return join(getSupersetHomeDir(), "practice.md");
		}
		if (options.projectId === null) {
			throw new Error("project-scoped practice requires a projectId");
		}
		const project = this.db.query.projects
			.findFirst({ where: eq(projects.id, options.projectId) })
			.sync();
		if (!project) {
			throw new Error(`Project not found: ${options.projectId}`);
		}
		return join(project.repoPath, "AGENTS.md");
	}

	/** Read the target file, or "" when it doesn't exist yet. */
	private readTargetFile(path: string): string {
		try {
			if (!existsSync(path)) return "";
			return readFileSync(path, "utf-8");
		} catch {
			return "";
		}
	}

	private loadConfirmedPlaybooks(options: {
		scope: PracticeScope;
		projectId: string | null;
	}): Playbook[] {
		const where =
			options.scope === "global"
				? eq(memoryPlaybooks.status, "confirmed")
				: options.projectId === null
					? eq(memoryPlaybooks.status, "confirmed")
					: and(
							eq(memoryPlaybooks.status, "confirmed"),
							eq(memoryPlaybooks.projectId, options.projectId),
						);
		return this.db
			.select()
			.from(memoryPlaybooks)
			.where(where)
			.orderBy(desc(memoryPlaybooks.updatedAt))
			.all()
			.map(rowToPlaybook);
	}

	/**
	 * PROPOSE — build a reviewable proposal WITHOUT writing anything. Loads the
	 * confirmed playbooks, runs the pure heuristic, and diffs the proposed block
	 * body against the current managed-block body in the target file.
	 */
	propose(options: {
		scope: PracticeScope;
		projectId: string | null;
	}): ConsolidationProposal {
		const playbooks = this.loadConfirmedPlaybooks(options);
		const proposal: PracticeProposal = consolidatePlaybooks({
			scope: options.scope,
			playbooks,
		});
		const proposedDoc = renderPracticeMarkdown(proposal);

		const targetPath = this.resolveTargetPath(options);
		const currentDoc = this.readCurrentDoc(options.scope, targetPath);

		return {
			scope: options.scope,
			projectId: options.scope === "global" ? null : options.projectId,
			currentDoc,
			proposedDoc,
			diff: computeLineDiff({ before: currentDoc, after: proposedDoc }),
			provenance: proposal.provenance,
			sourceCount: proposal.sourceCount,
			targetPath,
		};
	}

	/**
	 * The "current doc" we diff/version against. For project scope it's the
	 * managed-block body of `AGENTS.md` (so hand-written content is never part of
	 * the practice doc); for global scope the whole `practice.md` is managed.
	 */
	private readCurrentDoc(scope: PracticeScope, targetPath: string): string {
		const fileText = this.readTargetFile(targetPath);
		if (scope === "global") return fileText;
		const block = this.extractProjectBlock(fileText);
		return block ?? "";
	}

	private extractProjectBlock(fileText: string): string | null {
		// Project practice lives in the managed block; the rest of AGENTS.md is
		// hand-written and never part of the consolidated doc.
		return extractManagedBlock(fileText);
	}

	/**
	 * ACCEPT — write the (possibly user-edited) `content` to the target and
	 * record a new `memory_practice_versions` row. Project scope writes into the
	 * managed block of `AGENTS.md` (preserving the rest); global scope writes the
	 * whole `practice.md`. Returns the new version.
	 */
	accept(options: {
		scope: PracticeScope;
		projectId: string | null;
		content: string;
		/** Provenance to stamp on the version row. */
		provenance?: string | null;
	}): PracticeVersion {
		const targetPath = this.resolveTargetPath(options);
		this.writeDoc(options.scope, targetPath, options.content);
		return this.recordVersion({
			scope: options.scope,
			projectId: options.scope === "global" ? null : options.projectId,
			content: options.content,
			provenance: options.provenance ?? null,
		});
	}

	/**
	 * REVERT — restore the content of a prior (or specified) version to the
	 * target file AND record the restore as a NEW version (linear, auditable
	 * history — we never delete rows). Throws if there's nothing to revert to.
	 */
	revert(options: {
		scope: PracticeScope;
		projectId: string | null;
		/** Version to restore. Defaults to the version BEFORE the latest. */
		toVersion?: number;
	}): PracticeVersion {
		const history = this.listVersions(options);
		if (history.length === 0) {
			throw new Error("No practice versions to revert to");
		}

		let target: PracticeVersion | undefined;
		if (options.toVersion !== undefined) {
			target = history.find((v) => v.version === options.toVersion);
			if (!target) {
				throw new Error(`Practice version ${options.toVersion} not found`);
			}
		} else {
			// Default: the version immediately before the current latest.
			if (history.length < 2) {
				throw new Error("No prior practice version to revert to");
			}
			target = history[1];
		}

		const restored = target as PracticeVersion;
		const targetPath = this.resolveTargetPath(options);
		this.writeDoc(options.scope, targetPath, restored.content);
		return this.recordVersion({
			scope: options.scope,
			projectId: options.scope === "global" ? null : options.projectId,
			content: restored.content,
			provenance: `Reverted to version ${restored.version}`,
		});
	}

	/** Versions for a (scope, projectId), newest first. */
	listVersions(options: {
		scope: PracticeScope;
		projectId: string | null;
	}): PracticeVersion[] {
		const where =
			options.scope === "global"
				? eq(memoryPracticeVersions.scope, "global")
				: options.projectId === null
					? eq(memoryPracticeVersions.scope, "project")
					: and(
							eq(memoryPracticeVersions.scope, "project"),
							eq(memoryPracticeVersions.projectId, options.projectId),
						);
		return this.db
			.select()
			.from(memoryPracticeVersions)
			.where(where)
			.orderBy(desc(memoryPracticeVersions.version))
			.all()
			.map((row) => ({
				id: row.id,
				scope: row.scope as PracticeScope,
				projectId: row.projectId,
				version: row.version,
				content: row.content,
				provenance: row.provenance,
				createdAt: row.createdAt,
			}));
	}

	private writeDoc(
		scope: PracticeScope,
		targetPath: string,
		content: string,
	): void {
		mkdirSync(dirname(targetPath), { recursive: true });
		if (scope === "global") {
			// The whole practice.md is ours to manage.
			writeFileSync(
				targetPath,
				content.endsWith("\n") ? content : `${content}\n`,
			);
			return;
		}
		// Project: surgically update the managed block in AGENTS.md, preserving
		// every hand-written line.
		const existing = this.readTargetFile(targetPath);
		const next = applyManagedBlock({ existing, content });
		writeFileSync(targetPath, next);
	}

	private recordVersion(options: {
		scope: PracticeScope;
		projectId: string | null;
		content: string;
		provenance: string | null;
	}): PracticeVersion {
		const latest = this.db
			.select()
			.from(memoryPracticeVersions)
			.where(
				options.scope === "global"
					? eq(memoryPracticeVersions.scope, "global")
					: options.projectId === null
						? eq(memoryPracticeVersions.scope, "project")
						: and(
								eq(memoryPracticeVersions.scope, "project"),
								eq(memoryPracticeVersions.projectId, options.projectId),
							),
			)
			.orderBy(desc(memoryPracticeVersions.version))
			.get();
		const nextVersion = (latest?.version ?? 0) + 1;
		const id = randomUUID();
		this.db
			.insert(memoryPracticeVersions)
			.values({
				id,
				scope: options.scope,
				projectId: options.scope === "global" ? null : options.projectId,
				version: nextVersion,
				content: options.content,
				provenance: options.provenance,
			})
			.run();
		const row = this.db
			.select()
			.from(memoryPracticeVersions)
			.where(eq(memoryPracticeVersions.id, id))
			.get();
		if (!row) throw new Error("Failed to read back practice version");
		return {
			id: row.id,
			scope: row.scope as PracticeScope,
			projectId: row.projectId,
			version: row.version,
			content: row.content,
			provenance: row.provenance,
			createdAt: row.createdAt,
		};
	}
}
