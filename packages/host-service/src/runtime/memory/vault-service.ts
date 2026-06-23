import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildMemoryGraph,
	type MemoryGraph,
	type Playbook,
	type PlaybookProvenance,
	type PlaybookStatus,
	playbookNoteFilename,
	playbookSimilarity,
	renderPlaybookNote,
} from "@superset/memory";
import { and, desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { memoryPlaybooks, memoryPracticeVersions } from "../../db/schema.ts";
import { getMemoryVaultDir } from "./paths.ts";

/**
 * Obsidian vault generator + graph data (B6 host half). Projects the local
 * memory rows into a Markdown vault under `~/.superset/memory/vault/` (one note
 * per playbook, with `[[wikilinks]]`) and assembles the `{ nodes, edges }`
 * graph the panel renders. LOCAL-only, egress-free; the vault is idempotent and
 * regenerable — re-running rewrites notes deterministically and PRUNES notes
 * for playbooks that no longer exist.
 */

const PLAYBOOKS_SUBDIR = "playbooks";
/** Similarity threshold for "similar playbooks" wikilinks in a note. */
const NOTE_SIMILARITY_THRESHOLD = 0.34;
/** Max similar playbooks linked from a single note (keeps notes tidy). */
const MAX_SIMILAR_PER_NOTE = 8;

const KNOWN_STATUSES = new Set<PlaybookStatus>([
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
	const status = KNOWN_STATUSES.has(row.status as PlaybookStatus)
		? (row.status as PlaybookStatus)
		: "provisional";
	return {
		id: row.id,
		projectId: row.projectId,
		intent: row.intent,
		touchedPaths: parseStringArray(row.touchedPathsJson),
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

export interface RegenerateVaultResult {
	/** Absolute path of the vault root that was (re)generated. */
	vaultDir: string;
	/** Notes written this run. */
	written: number;
	/** Stale notes pruned (playbooks that no longer exist). */
	pruned: number;
}

export class MemoryVaultService {
	private readonly db: HostDb;

	constructor(options: { db: HostDb }) {
		this.db = options.db;
	}

	private loadGraphPlaybooks(projectId: string | null): Playbook[] {
		// Graph + vault show confirmed + provisional (the meaningful memory);
		// demoted/archived are excluded by the pure builder's status filter, but
		// we also keep them out of the vault notes.
		const where =
			projectId === null ? undefined : eq(memoryPlaybooks.projectId, projectId);
		return this.db
			.select()
			.from(memoryPlaybooks)
			.where(where)
			.orderBy(desc(memoryPlaybooks.updatedAt))
			.all()
			.map(rowToPlaybook)
			.filter((p) => p.status === "confirmed" || p.status === "provisional");
	}

	private existingPracticeScopes(
		projectId: string | null,
	): ("project" | "global")[] {
		const scopes: ("project" | "global")[] = [];
		if (projectId !== null) {
			const project = this.db
				.select()
				.from(memoryPracticeVersions)
				.where(
					and(
						eq(memoryPracticeVersions.scope, "project"),
						eq(memoryPracticeVersions.projectId, projectId),
					),
				)
				.get();
			if (project) scopes.push("project");
		}
		const global = this.db
			.select()
			.from(memoryPracticeVersions)
			.where(eq(memoryPracticeVersions.scope, "global"))
			.get();
		if (global) scopes.push("global");
		return scopes;
	}

	/** Assemble the `{ nodes, edges }` graph (no file I/O). */
	graph(options: { projectId: string | null }): MemoryGraph {
		const playbooks = this.loadGraphPlaybooks(options.projectId);
		const practices = this.existingPracticeScopes(options.projectId).map(
			(scope) => ({ scope }),
		);
		return buildMemoryGraph({ playbooks, practices });
	}

	/**
	 * Regenerate the on-disk vault: write one note per playbook (idempotent) and
	 * prune notes whose playbook no longer exists. Honors `SUPERSET_HOME_DIR`.
	 */
	regenerateVault(options: {
		projectId: string | null;
	}): RegenerateVaultResult {
		const playbooks = this.loadGraphPlaybooks(options.projectId);
		const practices = this.existingPracticeScopes(options.projectId);

		const vaultDir = getMemoryVaultDir();
		const playbooksDir = join(vaultDir, PLAYBOOKS_SUBDIR);
		mkdirSync(playbooksDir, { recursive: true });

		// Stable filename per playbook; collect the set we expect to exist so we
		// can prune everything else (forgotten playbooks).
		const expected = new Set<string>();
		let written = 0;
		for (const playbook of playbooks) {
			const filename = playbookNoteFilename(playbook);
			expected.add(filename);

			const similar = playbooks
				.filter((other) => other.id !== playbook.id)
				.map((other) => ({
					other,
					score: playbookSimilarity(playbook, other),
				}))
				.filter(({ score }) => score >= NOTE_SIMILARITY_THRESHOLD)
				.sort(
					(a, b) => b.score - a.score || a.other.id.localeCompare(b.other.id),
				)
				.slice(0, MAX_SIMILAR_PER_NOTE)
				.map(({ other }) => ({
					filename: playbookNoteFilename(other),
					intent: other.intent,
				}));

			const content = renderPlaybookNote({ playbook, similar, practices });
			writeFileSync(join(playbooksDir, filename), content);
			written++;
		}

		const pruned = this.pruneStaleNotes(playbooksDir, expected);
		return { vaultDir, written, pruned };
	}

	/** Delete `.md` notes in `dir` that aren't in `expected`. Best-effort. */
	private pruneStaleNotes(dir: string, expected: Set<string>): number {
		let pruned = 0;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return 0;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			if (expected.has(entry)) continue;
			try {
				rmSync(join(dir, entry), { force: true });
				pruned++;
			} catch {
				// best-effort prune; a locked/removed file is not fatal.
			}
		}
		return pruned;
	}
}
