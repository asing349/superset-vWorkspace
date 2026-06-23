import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	type AreaTag,
	buildStructuralEntry,
	contentHash,
	isFingerprintStale,
	type ProjectIndexEntry,
} from "@superset/memory";
import { getSearchIndex, searchContent } from "@superset/workspace-fs/host";
import { and, eq, inArray } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import {
	memoryFingerprints,
	memoryProjectIndex,
	projects,
} from "../../db/schema.ts";
import { ensureMemoryRootDir } from "./paths.ts";
import { extractSymbols } from "./symbol-extractor.ts";

const execFileAsync = promisify(execFile);

/** Files larger than this are indexed structurally but not read for symbols. */
const MAX_SYMBOL_FILE_BYTES = 512 * 1024;

export interface ProjectIndexServiceOptions {
	db: HostDb;
}

/** Public, serializable status of a project's index (consumed by B4). */
export interface ProjectIndexStatus {
	projectId: string;
	/** Whether any entries exist for this project. */
	indexed: boolean;
	entryCount: number;
	/** Most recent entry `updatedAt`, or null when empty. */
	lastIndexedAt: number | null;
	/** HEAD commit SHA recorded on the newest entries, or null. */
	commitSha: string | null;
}

interface ResolvedProject {
	projectId: string;
	repoPath: string;
}

/**
 * Lightweight per-project structural + lexical index (B3).
 *
 * - **Structural map**: enumerate source files via the workspace-fs file index
 *   (fast-glob — NO ripgrep), extract exported symbols (TS compiler API with a
 *   regex fallback), derive multi-label area tags, and persist one
 *   `memory_project_index` row per file plus a `memory_fingerprints` row
 *   (content hash + HEAD SHA) for staleness detection.
 * - **Lexical search**: reuse `searchContent` from workspace-fs, which injects a
 *   ripgrep runner AND falls back to a pure-JS scan when `rg` is absent. We
 *   additionally guard so a missing `rg` NEVER throws out of this service.
 * - **Incremental refresh**: `refreshPaths` re-indexes only the changed files
 *   and evicts deleted ones — driven by the host fs-event seam (GitWatcher).
 *
 * No embeddings (B7). Egress-free. Reuses workspace-fs read-only.
 */
export class ProjectIndexService {
	private readonly db: HostDb;
	/** Guards against concurrent full builds of the same project. */
	private readonly buildsInFlight = new Map<string, Promise<number>>();

	constructor(options: ProjectIndexServiceOptions) {
		this.db = options.db;
	}

	private resolveProject(projectId: string): ResolvedProject {
		const project = this.db
			.select({ id: projects.id, repoPath: projects.repoPath })
			.from(projects)
			.where(eq(projects.id, projectId))
			.get();
		if (!project) {
			throw new Error(`Project not found: ${projectId}`);
		}
		return { projectId: project.id, repoPath: project.repoPath };
	}

	/** Best-effort HEAD SHA; null when not a git repo or git is unavailable. */
	private async headSha(repoPath: string): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
				cwd: repoPath,
				windowsHide: true,
			});
			const sha = stdout.trim();
			return sha.length > 0 ? sha : null;
		} catch {
			return null;
		}
	}

	/**
	 * Build (or rebuild) the full index for a project. Idempotent: a path's row
	 * is upserted by `(projectId, path)`, and rows for files no longer present
	 * are evicted. Returns the number of indexed entries. Concurrent calls for
	 * the same project share one build.
	 */
	async buildProjectIndex(projectId: string): Promise<number> {
		const inFlight = this.buildsInFlight.get(projectId);
		if (inFlight) return inFlight;
		const build = this.doBuild(projectId).finally(() => {
			this.buildsInFlight.delete(projectId);
		});
		this.buildsInFlight.set(projectId, build);
		return build;
	}

	private async doBuild(projectId: string): Promise<number> {
		const { repoPath } = this.resolveProject(projectId);
		ensureMemoryRootDir();
		const commitSha = await this.headSha(repoPath);

		// File enumeration via the workspace-fs index (fast-glob, honors
		// DEFAULT_IGNORE_PATTERNS). This does NOT shell out to ripgrep.
		const files = await getSearchIndex({
			rootPath: repoPath,
			includeHidden: false,
		});
		const relativePaths = files.map((f) => f.relativePath);

		for (const relativePath of relativePaths) {
			await this.indexOnePath({ projectId, repoPath, relativePath, commitSha });
		}

		// Eviction: drop rows whose file is gone from the current file set.
		this.evictMissing({ projectId, presentPaths: new Set(relativePaths) });

		return relativePaths.length;
	}

	/**
	 * Index a single file: read (when reasonably sized), extract symbols, derive
	 * areas, compute a fingerprint, and upsert the index + fingerprint rows.
	 * Returns true when an entry was written.
	 */
	private async indexOnePath(options: {
		projectId: string;
		repoPath: string;
		relativePath: string;
		commitSha: string | null;
	}): Promise<boolean> {
		const { projectId, repoPath, relativePath, commitSha } = options;
		const absolutePath = join(repoPath, relativePath);

		let source: string | null = null;
		try {
			const buffer = await readFile(absolutePath);
			if (buffer.byteLength <= MAX_SYMBOL_FILE_BYTES) {
				source = buffer.toString("utf8");
			}
		} catch {
			// File vanished between enumeration and read — treat as eviction.
			this.evictPath({ projectId, relativePath });
			return false;
		}

		const symbols = source
			? extractSymbols({ path: relativePath, source })
			: [];
		const entry = buildStructuralEntry({ path: relativePath, source });
		const hash = contentHash(source ?? relativePath);

		const fingerprintId = this.upsertFingerprint({
			projectId,
			subject: relativePath,
			contentHash: hash,
			commitSha,
		});

		this.upsertIndexEntry({
			projectId,
			path: relativePath,
			areaTags: entry.areaTags,
			summary: entry.summary,
			fingerprintId,
		});

		// `symbols` informs the summary already; we keep extraction explicit so a
		// future schema (per-symbol rows) can consume it without re-reading files.
		void symbols;
		return true;
	}

	/**
	 * Incrementally refresh only the given repo-relative paths (from fs events).
	 * Re-indexes changed/created files and evicts deleted ones. Never rebuilds
	 * the whole project. Silently no-ops for an unindexed project.
	 */
	async refreshPaths(options: {
		projectId: string;
		paths: readonly string[];
	}): Promise<void> {
		const { projectId, paths } = options;
		if (paths.length === 0) return;

		let resolved: ResolvedProject;
		try {
			resolved = this.resolveProject(projectId);
		} catch {
			return;
		}
		const commitSha = await this.headSha(resolved.repoPath);

		for (const relativePath of paths) {
			await this.indexOnePath({
				projectId,
				repoPath: resolved.repoPath,
				relativePath,
				commitSha,
			});
		}
	}

	/**
	 * Lexical content search over a project, reusing workspace-fs `searchContent`
	 * (ripgrep with a built-in JS-scan fallback). Guarded so a missing `rg`
	 * binary degrades to an empty/scan result WITHOUT throwing.
	 */
	async lexicalSearch(options: {
		projectId: string;
		query: string;
		limit?: number;
		runRipgrep?: Parameters<typeof searchContent>[0]["runRipgrep"];
	}): Promise<Awaited<ReturnType<typeof searchContent>>> {
		const { projectId, query, limit, runRipgrep } = options;
		let resolved: ResolvedProject;
		try {
			resolved = this.resolveProject(projectId);
		} catch {
			return [];
		}
		try {
			return await searchContent({
				rootPath: resolved.repoPath,
				query,
				limit,
				...(runRipgrep ? { runRipgrep } : {}),
			});
		} catch {
			// searchContent already falls back to a JS scan when ripgrep throws;
			// this catch is a final belt-and-suspenders so the index never crashes
			// the caller in an `rg`-absent environment.
			return [];
		}
	}

	/** Serializable index status for a project (consumed by B4 retrieval). */
	indexStatus(projectId: string): ProjectIndexStatus {
		const rows = this.db
			.select({
				updatedAt: memoryProjectIndex.updatedAt,
				fingerprintId: memoryProjectIndex.fingerprintId,
			})
			.from(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, projectId))
			.all();

		if (rows.length === 0) {
			return {
				projectId,
				indexed: false,
				entryCount: 0,
				lastIndexedAt: null,
				commitSha: null,
			};
		}

		let lastIndexedAt = 0;
		let newestFingerprintId: string | null = null;
		for (const row of rows) {
			if (row.updatedAt > lastIndexedAt) {
				lastIndexedAt = row.updatedAt;
				newestFingerprintId = row.fingerprintId;
			}
		}

		let commitSha: string | null = null;
		if (newestFingerprintId) {
			const fp = this.db
				.select({ commitSha: memoryFingerprints.commitSha })
				.from(memoryFingerprints)
				.where(eq(memoryFingerprints.id, newestFingerprintId))
				.get();
			commitSha = fp?.commitSha ?? null;
		}

		return {
			projectId,
			indexed: true,
			entryCount: rows.length,
			lastIndexedAt,
			commitSha,
		};
	}

	/** List index entries for a project (B4 reads these as "index slices"). */
	listEntries(projectId: string): ProjectIndexEntry[] {
		const rows = this.db
			.select()
			.from(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, projectId))
			.all();
		return rows.map((row) => ({
			id: row.id,
			projectId: row.projectId,
			path: row.path,
			kind: row.kind,
			areaTags: parseAreaTags(row.areaTagsJson),
			summary: row.summary,
			fingerprintId: row.fingerprintId,
			updatedAt: row.updatedAt,
		}));
	}

	// --- persistence helpers ----------------------------------------------

	private upsertFingerprint(options: {
		projectId: string;
		subject: string;
		contentHash: string;
		commitSha: string | null;
	}): string {
		const existing = this.db
			.select({
				id: memoryFingerprints.id,
				contentHash: memoryFingerprints.contentHash,
			})
			.from(memoryFingerprints)
			.where(
				and(
					eq(memoryFingerprints.projectId, options.projectId),
					eq(memoryFingerprints.subject, options.subject),
				),
			)
			.get();

		if (existing) {
			if (
				isFingerprintStale({
					previousHash: existing.contentHash,
					currentHash: options.contentHash,
				})
			) {
				this.db
					.update(memoryFingerprints)
					.set({
						contentHash: options.contentHash,
						commitSha: options.commitSha,
						createdAt: Date.now(),
					})
					.where(eq(memoryFingerprints.id, existing.id))
					.run();
			}
			return existing.id;
		}

		const id = randomUUID();
		this.db
			.insert(memoryFingerprints)
			.values({
				id,
				projectId: options.projectId,
				subject: options.subject,
				contentHash: options.contentHash,
				commitSha: options.commitSha,
			})
			.run();
		return id;
	}

	private upsertIndexEntry(options: {
		projectId: string;
		path: string;
		areaTags: AreaTag[];
		summary: string;
		fingerprintId: string;
	}): void {
		const existing = this.db
			.select({ id: memoryProjectIndex.id })
			.from(memoryProjectIndex)
			.where(
				and(
					eq(memoryProjectIndex.projectId, options.projectId),
					eq(memoryProjectIndex.path, options.path),
				),
			)
			.get();

		const now = Date.now();
		if (existing) {
			this.db
				.update(memoryProjectIndex)
				.set({
					areaTagsJson: JSON.stringify(options.areaTags),
					summary: options.summary,
					fingerprintId: options.fingerprintId,
					updatedAt: now,
				})
				.where(eq(memoryProjectIndex.id, existing.id))
				.run();
			return;
		}

		this.db
			.insert(memoryProjectIndex)
			.values({
				id: randomUUID(),
				projectId: options.projectId,
				path: options.path,
				kind: "file",
				areaTagsJson: JSON.stringify(options.areaTags),
				summary: options.summary,
				fingerprintId: options.fingerprintId,
			})
			.run();
	}

	private evictPath(options: {
		projectId: string;
		relativePath: string;
	}): void {
		this.db
			.delete(memoryProjectIndex)
			.where(
				and(
					eq(memoryProjectIndex.projectId, options.projectId),
					eq(memoryProjectIndex.path, options.relativePath),
				),
			)
			.run();
		this.db
			.delete(memoryFingerprints)
			.where(
				and(
					eq(memoryFingerprints.projectId, options.projectId),
					eq(memoryFingerprints.subject, options.relativePath),
				),
			)
			.run();
	}

	private evictMissing(options: {
		projectId: string;
		presentPaths: Set<string>;
	}): void {
		const rows = this.db
			.select({ id: memoryProjectIndex.id, path: memoryProjectIndex.path })
			.from(memoryProjectIndex)
			.where(eq(memoryProjectIndex.projectId, options.projectId))
			.all();
		const stalePaths = rows
			.filter((row) => !options.presentPaths.has(row.path))
			.map((row) => row.path);
		if (stalePaths.length === 0) return;

		this.db
			.delete(memoryProjectIndex)
			.where(
				and(
					eq(memoryProjectIndex.projectId, options.projectId),
					inArray(memoryProjectIndex.path, stalePaths),
				),
			)
			.run();
		this.db
			.delete(memoryFingerprints)
			.where(
				and(
					eq(memoryFingerprints.projectId, options.projectId),
					inArray(memoryFingerprints.subject, stalePaths),
				),
			)
			.run();
	}
}

function parseAreaTags(value: string): AreaTag[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((item): item is AreaTag => typeof item === "string");
}
