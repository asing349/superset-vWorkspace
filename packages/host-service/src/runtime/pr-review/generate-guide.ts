import type {
	AreaTag,
	PlaybookStatus,
	PracticeVersion,
	ProjectIndexEntry,
	RetrievalBundle,
} from "@superset/memory";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { memoryPlaybooks } from "../../db/schema.ts";
import type { FileStatus } from "../../trpc/router/git/types.ts";
import type {
	FetchPrDiffDeps,
	PrDiffResult as RawPrDiffResult,
} from "../../trpc/router/pr-review/fetch-pr-diff.ts";
import { fetchPrDiff } from "../../trpc/router/pr-review/fetch-pr-diff.ts";
import {
	buildGuideSkeleton,
	type GuideGroundingServices,
} from "./build-guide-skeleton.ts";
import { getAcceptedObservedRules } from "./business-rules-store.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import { enrichGuide } from "./enrich-guide.ts";
import { getCurrentGuide, putGuide } from "./guide-cache.ts";
import type { PrDiffInput, PrReviewGuide } from "./guide-types.ts";

/** One raw diff file as M1's `fetchPrDiff` returns it (status is a raw string). */
type RawPrDiffFile = RawPrDiffResult["files"][number];
/** An M3-shaped diff file (status narrowed to the `FileStatus` union). */
type GuideDiffFile = PrDiffInput["files"][number];

/**
 * Guide generation orchestration (Wave 5, M4 core).
 *
 * `generateGuide` is the SINGLE pipeline behind the "Generate guide" button:
 *   fetchPrDiff (M1) → normalize file status → buildGuideSkeleton (M3) →
 *   enrichGuide via a local AI session if one is available (M4) →
 *   persist via the shared guide-cache (M6, owned by diff).
 *
 * It is invoked ONLY from the `prReview.generateGuide` MUTATION — never on
 * open/view/commit. The pipeline is assembled from injected PORTS so the core
 * is unit-testable without a live GitHub fetch, a real chat session, or the
 * concrete memory services.
 */

// ---------------------------------------------------------------------------
// File-status reconciliation (M1's raw string → M3's FileStatus union)
// ---------------------------------------------------------------------------

const FILE_STATUSES: ReadonlySet<FileStatus> = new Set<FileStatus>([
	"added",
	"copied",
	"changed",
	"deleted",
	"modified",
	"renamed",
	"untracked",
]);

/**
 * Normalize a raw GitHub/git status string onto the `FileStatus` union M3
 * expects. GitHub's `pulls/{n}/files` uses `removed` for deletions; the local
 * fallback already emits git's `FileStatus` values. Anything unrecognized
 * collapses to `changed` (never throws, never `any`).
 */
export function normalizeFileStatus(status: string): FileStatus {
	const lower = status.toLowerCase();
	if (lower === "removed") return "deleted";
	if (FILE_STATUSES.has(lower as FileStatus)) return lower as FileStatus;
	return "changed";
}

/** Project an M1 raw diff file (status: string) onto an M3 file (FileStatus). */
function toGuideDiffFile(file: RawPrDiffFile): GuideDiffFile {
	const normalized: GuideDiffFile = {
		filename: file.filename,
		status: normalizeFileStatus(file.status),
		patch: file.patch,
		additions: file.additions,
		deletions: file.deletions,
	};
	if (file.previousFilename !== undefined) {
		normalized.previousFilename = file.previousFilename;
	}
	return normalized;
}

/** Reconcile an M1 `PrDiffResult` into the M3 `PrDiffInput` (status-normalized). */
export function toGuideDiffInput(result: RawPrDiffResult): PrDiffInput {
	return {
		files: result.files.map(toGuideDiffFile),
		body: result.body,
		baseBranch: result.baseBranch,
		headSha: result.headSha,
		prNumber: result.prNumber,
	};
}

// ---------------------------------------------------------------------------
// Grounding services adapter (ctx runtime accessors → GuideGroundingServices)
// ---------------------------------------------------------------------------

/** The memory-retrieve accessor the grounding adapter reads. */
export interface GuideMemoryRetrieve {
	retrieve(input: {
		projectId: string | null;
		intent: string;
		areaTags?: readonly AreaTag[];
	}): Promise<RetrievalBundle>;
}

/** The project-index accessor the grounding adapter reads. */
export interface GuideMemoryIndex {
	indexStatus(projectId: string): { indexed: boolean; entryCount: number };
	listEntries(projectId: string): ProjectIndexEntry[];
}

/**
 * Build the `GuideGroundingServices` bundle M3 consumes from the host db + the
 * memory runtime. Practice + playbook reads are direct table queries (mirroring
 * the `memory` router's `getPractice`/`listPlaybooks` semantics) so the builder
 * gets the same grounding the router would surface.
 */
export function buildGroundingServices(deps: {
	db: HostDb;
	memoryRetrieve: GuideMemoryRetrieve;
	memoryIndex: GuideMemoryIndex;
	readPracticeVersion: (input: {
		scope: "project" | "global";
		projectId: string | null;
	}) => PracticeVersion | null;
}): GuideGroundingServices {
	const { db, memoryRetrieve, memoryIndex, readPracticeVersion } = deps;
	return {
		retrieve: { retrieve: (input) => memoryRetrieve.retrieve(input) },
		index: {
			indexStatus: (projectId) => memoryIndex.indexStatus(projectId),
			listEntries: (projectId) => memoryIndex.listEntries(projectId),
		},
		practice: {
			getPractice: ({ scope, projectId }) => ({
				latest: readPracticeVersion({ scope, projectId }),
			}),
		},
		playbooks: {
			listPlaybooks: ({ projectId }) => {
				const rows = db
					.select()
					.from(memoryPlaybooks)
					.where(
						projectId === null
							? undefined
							: eq(memoryPlaybooks.projectId, projectId),
					)
					.all();
				return rows.map((row) => ({
					id: row.id,
					intent: row.intent,
					areaTags: parseAreaTags(row.areaTagsJson),
					status: row.status as PlaybookStatus,
					confidence: row.confidence,
					provenance: parseProvenance(row.provenanceJson),
				}));
			},
		},
		// Wave-6 M6: surface the project's ACCEPTED observed business rules so later
		// reviews ground on them (the compounding differentiator).
		businessRules: {
			listAccepted: (projectId) =>
				getAcceptedObservedRules({ db, projectId }).map((rule) => ({
					rule: rule.rule,
				})),
		},
	};
}

function parseAreaTags(value: string): AreaTag[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((t): t is AreaTag => typeof t === "string");
	} catch {
		return [];
	}
}

function parseProvenance(value: string): {
	prNumber: number | null;
	url: string | null;
} {
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null) {
			return { prNumber: null, url: null };
		}
		const obj = parsed as Record<string, unknown>;
		return {
			prNumber: typeof obj.prNumber === "number" ? obj.prNumber : null,
			url: typeof obj.url === "string" ? obj.url : null,
		};
	} catch {
		return { prNumber: null, url: null };
	}
}

// ---------------------------------------------------------------------------
// Orchestration core (port-injected; unit-testable without GitHub / chat / db)
// ---------------------------------------------------------------------------

/** The diff-fetch port (M1's `fetchPrDiff`, narrowed for injection). */
export interface GuideDiffSource {
	fetch(input: {
		projectId: string;
		prNumber: number;
	}): Promise<RawPrDiffResult>;
}

/** The guide-cache port (M6's `putGuide`, narrowed for injection). */
export interface GuideCacheSink {
	put(input: {
		projectId: string;
		prNumber: number;
		headSha: string;
		guide: PrReviewGuide;
	}): void;
}

export interface GenerateGuideCoreInput {
	projectId: string;
	prNumber: number;
	diffSource: GuideDiffSource;
	grounding: GuideGroundingServices;
	/** A local AI session, or null when none is connected (→ deterministic only). */
	session: GuideEnrichmentSession | null;
	/** Persist sink; omit to skip persistence (e.g. in a pure unit test). */
	cache?: GuideCacheSink;
	signal?: AbortSignal;
}

/**
 * The orchestration CORE: fetch → normalize → skeleton → (best-effort) enrich →
 * persist. Returns the final guide. Decoupled from `ctx`, GitHub, the chat
 * runtime, and the db via injected ports, so it is fully unit-testable. When no
 * session is supplied (or it isn't available) the result is the deterministic +
 * grounded skeleton; enrichment never throws out of this path.
 */
export async function generateGuideCore(
	input: GenerateGuideCoreInput,
): Promise<PrReviewGuide> {
	const { projectId, prNumber, diffSource, grounding, session, cache, signal } =
		input;

	const raw = await diffSource.fetch({ projectId, prNumber });
	const diff = toGuideDiffInput(raw);

	const skeleton = await buildGuideSkeleton({
		diff,
		projectId,
		services: grounding,
	});

	const guide = session
		? await enrichGuide({ skeleton, diff, session, signal })
		: skeleton;

	// Persist only when we actually have a head SHA to key on (an empty fetch
	// yields headSha ""); a missing SHA means the diff couldn't resolve, so
	// caching an empty guide under "" would shadow a real one.
	if (cache && guide.headSha.length > 0) {
		cache.put({ projectId, prNumber, headSha: guide.headSha, guide });
	}

	return guide;
}

// ---------------------------------------------------------------------------
// tRPC-facing entry point (assembles the ports from the host context)
// ---------------------------------------------------------------------------

export interface GenerateGuideInput {
	db: HostDb;
	fetchDeps: FetchPrDiffDeps;
	grounding: GuideGroundingServices;
	/** A local AI session, or null when none is connected. */
	session: GuideEnrichmentSession | null;
	projectId: string;
	prNumber: number;
	signal?: AbortSignal;
}

/**
 * Host-facing `generateGuide`: wires M1's `fetchPrDiff` and M6's `putGuide` into
 * {@link generateGuideCore}. The `prReview.generateGuide` MUTATION calls this.
 */
export async function generateGuide(
	input: GenerateGuideInput,
): Promise<PrReviewGuide> {
	const { db, fetchDeps, grounding, session, projectId, prNumber, signal } =
		input;

	return generateGuideCore({
		projectId,
		prNumber,
		grounding,
		session,
		signal,
		diffSource: {
			fetch: ({ projectId: pid, prNumber: pr }) =>
				fetchPrDiff({ ...fetchDeps, projectId: pid, prNumber: pr }),
		},
		cache: {
			put: ({ projectId: pid, prNumber: pr, headSha, guide }) =>
				putGuide({ db, projectId: pid, prNumber: pr, headSha, guide }),
		},
	});
}

/**
 * Host-facing `getCachedGuide`: reads the current cached guide for a PR (the
 * renderer calls this on open — it NEVER generates). Returns `{ guide, stale }`
 * or null when nothing is cached.
 */
export function getCachedGuide(input: {
	db: HostDb;
	projectId: string;
	prNumber: number;
}): { guide: PrReviewGuide; stale: boolean } | null {
	const current = getCurrentGuide({
		db: input.db,
		projectId: input.projectId,
		prNumber: input.prNumber,
	});
	if (!current) return null;
	return { guide: current.guide, stale: current.stale };
}
