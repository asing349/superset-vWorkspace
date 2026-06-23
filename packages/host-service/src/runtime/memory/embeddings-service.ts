import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	contentHash,
	isLoopbackUrl,
	type StoredVector,
	topKBySimilarity,
} from "@superset/memory";
import {
	getSearchIndex,
	invalidateSearchIndexesForRoot,
} from "@superset/workspace-fs/host";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { projects } from "../../db/schema.ts";
import { getMemoryRootDir } from "./paths.ts";

/**
 * Optional local semantic embeddings (B7a). OFF BY DEFAULT.
 *
 * The ONLY part of Part B allowed any network call — and ONLY to an explicitly
 * LOCAL Ollama-style endpoint (`127.0.0.1:11434` by default, loopback-only,
 * HARD-GATED by `isLoopbackUrl`). With embeddings off OR no local model
 * detected, ZERO network calls occur and behavior is the lightweight index
 * only. Auto-detect is best-effort with a fast timeout and degrades silently.
 *
 * - Settings (enabled flag + endpoint) persist to `~/.superset/memory/
 *   embeddings-settings.json` (honors SUPERSET_HOME_DIR). No always-on schema.
 * - Vectors persist to a small flat file per project under
 *   `~/.superset/memory/embeddings/<projectId>.json`, loaded only when enabled.
 * - Incremental: reuses a per-file content hash (the same FNV-1a hash B3 uses)
 *   so only changed files are re-embedded; deleted files evict.
 * - Ranking: brute-force cosine similarity (no ANN library — A12).
 */

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "nomic-embed-text";
const DETECT_TIMEOUT_MS = 1500;
const DETECT_CACHE_MS = 30_000;
const MAX_EMBED_FILE_BYTES = 256 * 1024;

/** Minimal embeddings client surface (injectable so tests never hit a net). */
export interface EmbeddingsClient {
	/** Probe whether a local model is reachable at `endpoint`. */
	detect(options: {
		endpoint: string;
		signal?: AbortSignal;
	}): Promise<{ available: boolean; model?: string }>;
	/** Embed one text into a vector. Throws on failure (caller catches). */
	embed(options: {
		endpoint: string;
		model: string;
		text: string;
		signal?: AbortSignal;
	}): Promise<number[]>;
}

export interface EmbeddingsSettings {
	enabled: boolean;
	endpoint: string;
	model: string;
}

export interface EmbeddingsStatus {
	/** A local model was detected at the endpoint (independent of `enabled`). */
	available: boolean;
	/** The user-set toggle (persisted). */
	enabled: boolean;
	endpoint: string;
	model?: string;
	/** Number of embedded files for the queried project (0 when none). */
	embeddedCount: number;
	/** Last detection/embedding error message, if any (best-effort). */
	lastError?: string;
}

interface VectorMeta {
	path: string;
	contentHash: string;
}

interface VectorRecord extends VectorMeta {
	id: string;
	vector: number[];
}

interface ProjectVectorStoreFile {
	projectId: string;
	model: string;
	vectors: VectorRecord[];
}

export interface EmbeddingsServiceOptions {
	db: HostDb;
	/** Injected for tests; defaults to a loopback-gated fetch client. */
	client?: EmbeddingsClient;
	/** Injected fetch for tests; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

/** A semantic match returned to the retrieval blend. */
export interface SemanticMatch {
	path: string;
	similarity: number;
}

export class MemoryEmbeddingsService {
	private readonly db: HostDb;
	private readonly client: EmbeddingsClient;
	private detectCache: {
		at: number;
		available: boolean;
		model?: string;
	} | null = null;
	private lastError: string | undefined;

	constructor(options: EmbeddingsServiceOptions) {
		this.db = options.db;
		this.client =
			options.client ??
			createOllamaEmbeddingsClient({ fetchImpl: options.fetchImpl });
	}

	// --- settings (file-backed, no schema) ---------------------------------

	private settingsPath(): string {
		return join(getMemoryRootDir(), "embeddings-settings.json");
	}

	readSettings(): EmbeddingsSettings {
		const path = this.settingsPath();
		if (!existsSync(path)) {
			return {
				enabled: false,
				endpoint: DEFAULT_ENDPOINT,
				model: DEFAULT_MODEL,
			};
		}
		try {
			const parsed = JSON.parse(
				readFileSync(path, "utf8"),
			) as Partial<EmbeddingsSettings>;
			const endpoint =
				typeof parsed.endpoint === "string" && isLoopbackUrl(parsed.endpoint)
					? parsed.endpoint
					: DEFAULT_ENDPOINT;
			return {
				enabled: parsed.enabled === true,
				endpoint,
				model: typeof parsed.model === "string" ? parsed.model : DEFAULT_MODEL,
			};
		} catch {
			return {
				enabled: false,
				endpoint: DEFAULT_ENDPOINT,
				model: DEFAULT_MODEL,
			};
		}
	}

	/**
	 * Persist the enabled flag (and optionally endpoint/model). The endpoint is
	 * REJECTED if it is not loopback — we never store a non-local target.
	 */
	setSettings(input: {
		enabled: boolean;
		endpoint?: string;
		model?: string;
	}): EmbeddingsSettings {
		const current = this.readSettings();
		let endpoint = current.endpoint;
		if (input.endpoint !== undefined) {
			if (!isLoopbackUrl(input.endpoint)) {
				throw new Error(
					`Refusing non-local embeddings endpoint: ${input.endpoint} (loopback only)`,
				);
			}
			endpoint = input.endpoint;
		}
		const next: EmbeddingsSettings = {
			enabled: input.enabled,
			endpoint,
			model: input.model ?? current.model,
		};
		mkdirSync(getMemoryRootDir(), { recursive: true });
		writeFileSync(this.settingsPath(), JSON.stringify(next, null, 2), "utf8");
		// A settings change may flip availability; drop the detect cache.
		this.detectCache = null;
		return next;
	}

	// --- detection (loopback-only, fast-timeout, cached) -------------------

	/**
	 * Best-effort probe of the local endpoint. Returns availability WITHOUT
	 * enabling anything. Never throws; a refused/absent probe → `available:false`.
	 * Skips the network entirely (and any non-local URL) when the endpoint isn't
	 * loopback.
	 */
	async detect(options?: {
		endpoint?: string;
		force?: boolean;
	}): Promise<{ available: boolean; model?: string }> {
		const settings = this.readSettings();
		const endpoint = options?.endpoint ?? settings.endpoint;

		// HARD GATE: never contact a non-loopback host.
		if (!isLoopbackUrl(endpoint)) {
			this.lastError = `Endpoint is not loopback: ${endpoint}`;
			return { available: false };
		}

		if (
			!options?.force &&
			this.detectCache &&
			Date.now() - this.detectCache.at < DETECT_CACHE_MS
		) {
			return {
				available: this.detectCache.available,
				model: this.detectCache.model,
			};
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
		try {
			const result = await this.client.detect({
				endpoint,
				signal: controller.signal,
			});
			this.detectCache = {
				at: Date.now(),
				available: result.available,
				model: result.model,
			};
			if (result.available) this.lastError = undefined;
			return result;
		} catch (error) {
			this.lastError =
				error instanceof Error ? error.message : "detection failed";
			this.detectCache = { at: Date.now(), available: false };
			return { available: false };
		} finally {
			clearTimeout(timer);
		}
	}

	/** Combined status for `memory.embeddingsStatus` (B7b toggle reads this). */
	async status(projectId?: string | null): Promise<EmbeddingsStatus> {
		const settings = this.readSettings();
		// Only probe the network when the user has enabled embeddings — disabled
		// = ZERO network calls.
		const detection = settings.enabled
			? await this.detect()
			: { available: false, model: undefined };
		const embeddedCount =
			projectId != null ? this.loadStore(projectId).vectors.length : 0;
		return {
			available: detection.available,
			enabled: settings.enabled,
			endpoint: settings.endpoint,
			model: detection.model ?? settings.model,
			embeddedCount,
			lastError: this.lastError,
		};
	}

	// --- vector store (flat file per project) ------------------------------

	private storePath(projectId: string): string {
		return join(getMemoryRootDir(), "embeddings", `${projectId}.json`);
	}

	private loadStore(projectId: string): ProjectVectorStoreFile {
		const path = this.storePath(projectId);
		if (!existsSync(path)) {
			return { projectId, model: this.readSettings().model, vectors: [] };
		}
		try {
			const parsed = JSON.parse(
				readFileSync(path, "utf8"),
			) as ProjectVectorStoreFile;
			if (!Array.isArray(parsed.vectors)) {
				return { projectId, model: this.readSettings().model, vectors: [] };
			}
			return parsed;
		} catch {
			return { projectId, model: this.readSettings().model, vectors: [] };
		}
	}

	private saveStore(store: ProjectVectorStoreFile): void {
		const path = this.storePath(store.projectId);
		mkdirSync(join(getMemoryRootDir(), "embeddings"), { recursive: true });
		writeFileSync(path, JSON.stringify(store), "utf8");
	}

	// --- (re)indexing -------------------------------------------------------

	/**
	 * Build/refresh embeddings for a project. NO-OP (returns `embedded: 0`) when
	 * disabled or no local model is available — so disabled ⇒ zero network. Only
	 * files whose content hash changed are re-embedded (fingerprint-driven);
	 * vectors for deleted files evict. Best-effort: a per-file embed failure is
	 * skipped, never thrown.
	 */
	async reindex(projectId: string): Promise<{
		embedded: number;
		evicted: number;
		skipped: boolean;
	}> {
		const settings = this.readSettings();
		if (!settings.enabled) return { embedded: 0, evicted: 0, skipped: true };

		const detection = await this.detect();
		if (!detection.available) return { embedded: 0, evicted: 0, skipped: true };

		const project = this.db
			.select({ repoPath: projects.repoPath })
			.from(projects)
			.where(eq(projects.id, projectId))
			.get();
		if (!project) return { embedded: 0, evicted: 0, skipped: true };

		const model = detection.model ?? settings.model;
		const store = this.loadStore(projectId);
		// If the model changed, the existing vectors aren't comparable — reset.
		const existing =
			store.model === model
				? new Map(store.vectors.map((v) => [v.path, v]))
				: new Map<string, VectorRecord>();

		// Invalidate the workspace-fs file-index cache first so a freshly-deleted
		// file is actually seen as gone (so its vector evicts) and new files embed.
		invalidateSearchIndexesForRoot(project.repoPath);
		const files = await getSearchIndex({
			rootPath: project.repoPath,
			includeHidden: false,
		});
		const presentPaths = new Set(files.map((f) => f.relativePath));

		let embedded = 0;
		const nextVectors: VectorRecord[] = [];
		for (const file of files) {
			const relativePath = file.relativePath;
			let source: string;
			try {
				const buffer = await readFile(join(project.repoPath, relativePath));
				if (buffer.byteLength > MAX_EMBED_FILE_BYTES) {
					// Too large to embed — keep any prior vector if its hash matches.
					const prior = existing.get(relativePath);
					if (prior) nextVectors.push(prior);
					continue;
				}
				source = buffer.toString("utf8");
			} catch {
				continue;
			}

			const hash = contentHash(source);
			const prior = existing.get(relativePath);
			if (prior && prior.contentHash === hash) {
				// Unchanged → reuse the existing embedding (no network call).
				nextVectors.push(prior);
				continue;
			}

			try {
				const vector = await this.client.embed({
					endpoint: settings.endpoint,
					model,
					text: source.slice(0, MAX_EMBED_FILE_BYTES),
				});
				nextVectors.push({
					id: prior?.id ?? randomUUID(),
					path: relativePath,
					contentHash: hash,
					vector,
				});
				embedded += 1;
			} catch (error) {
				this.lastError =
					error instanceof Error ? error.message : "embed failed";
				// Keep the prior vector if we had one; otherwise skip this file.
				if (prior) nextVectors.push(prior);
			}
		}

		const evicted = store.vectors.filter(
			(v) => !presentPaths.has(v.path),
		).length;

		this.saveStore({ projectId, model, vectors: nextVectors });
		return { embedded, evicted, skipped: false };
	}

	/** Drop a project's vector store (e.g. when embeddings are disabled). */
	clear(projectId: string): void {
		this.saveStore({
			projectId,
			model: this.readSettings().model,
			vectors: [],
		});
	}

	// --- semantic search (for the retrieval blend) -------------------------

	/**
	 * Top-k semantic matches for a query. Returns `[]` (and makes ZERO network
	 * calls) when disabled, unavailable, or the store is empty. Embeds the query
	 * via the local model when enabled+available.
	 */
	async semanticSearch(options: {
		projectId: string;
		query: string;
		topK?: number;
		minScore?: number;
	}): Promise<SemanticMatch[]> {
		const settings = this.readSettings();
		if (!settings.enabled || options.query.trim().length === 0) return [];

		const store = this.loadStore(options.projectId);
		if (store.vectors.length === 0) return [];

		const detection = await this.detect();
		if (!detection.available) return [];

		let queryVector: number[];
		try {
			queryVector = await this.client.embed({
				endpoint: settings.endpoint,
				model: detection.model ?? settings.model,
				text: options.query,
			});
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : "embed failed";
			return [];
		}

		const items: StoredVector<VectorMeta>[] = store.vectors.map((v) => ({
			vector: v.vector,
			meta: { path: v.path, contentHash: v.contentHash },
		}));
		return topKBySimilarity({
			query: queryVector,
			items,
			topK: options.topK ?? 5,
			minScore: options.minScore ?? 0.2,
		}).map((scored) => ({ path: scored.meta.path, similarity: scored.score }));
	}
}

/**
 * Default embeddings client: a loopback-gated `fetch` to an Ollama-style HTTP
 * API. `detect` hits `GET /api/tags`; `embed` POSTs `/api/embeddings`. EVERY
 * request is HARD-GATED by `isLoopbackUrl` so a non-local endpoint short-circuits
 * before any network call. Injectable `fetchImpl` keeps tests off the network.
 */
export function createOllamaEmbeddingsClient(options?: {
	fetchImpl?: typeof fetch;
}): EmbeddingsClient {
	const doFetch = options?.fetchImpl ?? fetch;
	return {
		async detect({ endpoint, signal }) {
			if (!isLoopbackUrl(endpoint)) return { available: false };
			const res = await doFetch(`${endpoint.replace(/\/$/, "")}/api/tags`, {
				method: "GET",
				signal,
			});
			if (!res.ok) return { available: false };
			let model: string | undefined;
			try {
				const body = (await res.json()) as {
					models?: Array<{ name?: string }>;
				};
				model = body.models?.find((m) => typeof m.name === "string")?.name;
			} catch {
				model = undefined;
			}
			return { available: true, model };
		},
		async embed({ endpoint, model, text, signal }) {
			if (!isLoopbackUrl(endpoint)) {
				throw new Error(`Refusing non-local embeddings endpoint: ${endpoint}`);
			}
			const res = await doFetch(
				`${endpoint.replace(/\/$/, "")}/api/embeddings`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ model, prompt: text }),
					signal,
				},
			);
			if (!res.ok) {
				throw new Error(`Embeddings request failed: ${res.status}`);
			}
			const body = (await res.json()) as { embedding?: number[] };
			if (!Array.isArray(body.embedding)) {
				throw new Error("Embeddings response missing `embedding` array");
			}
			return body.embedding;
		},
	};
}
