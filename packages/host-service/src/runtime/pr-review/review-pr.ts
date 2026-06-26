import type { HostDb } from "../../db/index.ts";
import type {
	FetchPrDiffDeps,
	PrDiffResult as RawPrDiffResult,
} from "../../trpc/router/pr-review/fetch-pr-diff.ts";
import { fetchPrDiff } from "../../trpc/router/pr-review/fetch-pr-diff.ts";
import {
	buildFindingsPrompt,
	deriveBaselineFindings,
} from "./build-findings.ts";
import {
	buildGuideSkeleton,
	type GuideGroundingServices,
} from "./build-guide-skeleton.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import { getCurrentFindings, putFindings } from "./findings-cache.ts";
import type { Finding, FindingsReport } from "./findings-types.ts";
import { toGuideDiffInput } from "./generate-guide.ts";
import { buildLocalAiFindings, parseFindingsReply } from "./parse-findings.ts";

/**
 * PR review orchestration (Wave 6, M1) — the `reviewPr` engine, mirroring the
 * wave-5 `generateGuideCore` pipeline shape:
 *   fetchPrDiff → diff file set → deterministic baseline findings (always) →
 *   best-effort local-AI findings (validated + redacted + line-anchored) →
 *   persist to the host findings cache.
 *
 * It is invoked ONLY from the `prReview.reviewPr` MUTATION — never on open / view
 * / tab-switch / new commit (a new commit only flips the cached findings `stale`).
 * The core is assembled from injected PORTS so it is unit-testable without a live
 * GitHub fetch, a real chat session, or the concrete db.
 */

/** The diff-fetch port (M1's `fetchPrDiff`, narrowed for injection). */
export interface ReviewDiffSource {
	fetch(input: {
		projectId: string;
		prNumber: number;
	}): Promise<RawPrDiffResult>;
}

/** The findings-cache port (narrowed `putFindings`, for injection). */
export interface FindingsCacheSink {
	put(input: {
		projectId: string;
		prNumber: number;
		headSha: string;
		report: FindingsReport;
	}): void;
}

export interface ReviewPrCoreInput {
	projectId: string;
	prNumber: number;
	diffSource: ReviewDiffSource;
	grounding: GuideGroundingServices;
	/** A local AI session, or null when none is connected (→ baseline only). */
	session: GuideEnrichmentSession | null;
	/** Persist sink; omit to skip persistence (e.g. in a pure unit test). */
	cache?: FindingsCacheSink;
	signal?: AbortSignal;
}

/** Build the changed-file set (incl. rename `previousFilename`) from the diff. */
function buildDiffFileSet(raw: RawPrDiffResult): Set<string> {
	const set = new Set<string>();
	for (const file of raw.files) {
		set.add(file.filename);
		if (file.previousFilename) set.add(file.previousFilename);
	}
	return set;
}

/** Map each changed file to its raw unified-diff patch (null when omitted). */
function buildPatchByFile(raw: RawPrDiffResult): Map<string, string | null> {
	const map = new Map<string, string | null>();
	for (const file of raw.files) {
		map.set(file.filename, file.patch);
		if (file.previousFilename) map.set(file.previousFilename, file.patch);
	}
	return map;
}

/**
 * Best-effort local-AI findings pass. Returns `[]` (never throws) when no session
 * is available, the session declines/errors/times out, or the reply doesn't
 * parse — the deterministic baseline is the floor regardless. All validation,
 * redaction, and `@@` line anchoring happens in {@link buildLocalAiFindings}.
 */
async function runLocalAiFindings(input: {
	raw: RawPrDiffResult;
	diff: ReturnType<typeof toGuideDiffInput>;
	session: GuideEnrichmentSession;
	signal?: AbortSignal;
}): Promise<Finding[]> {
	const { raw, diff, session, signal } = input;
	try {
		if (!(await session.isAvailable())) return [];
		const prompt = buildFindingsPrompt({ diff });
		const reply = await session.complete({ prompt, signal });
		if (!reply) return [];
		const parsed = parseFindingsReply(reply);
		if (!parsed) return [];
		return buildLocalAiFindings({
			rawFindings: parsed,
			diffFileSet: buildDiffFileSet(raw),
			patchByFile: buildPatchByFile(raw),
		});
	} catch {
		// Best-effort: any failure degrades to the deterministic baseline.
		return [];
	}
}

/**
 * The orchestration CORE: fetch → baseline findings → (best-effort) local-AI
 * findings → persist. Returns the final report. Decoupled from `ctx`, GitHub, the
 * chat runtime, and the db via injected ports. When no session is supplied (no
 * local agent), the report is the deterministic baseline and `baselineOnly` is
 * true; the local-AI pass never throws out of this path.
 */
export async function reviewPrCore(
	input: ReviewPrCoreInput,
): Promise<FindingsReport> {
	const { projectId, prNumber, diffSource, grounding, session, cache, signal } =
		input;

	const raw = await diffSource.fetch({ projectId, prNumber });
	const diff = toGuideDiffInput(raw);

	// Deterministic baseline — always available (reuses the skeleton's risk
	// heuristics). Grounding may add nothing for an unindexed repo; that's fine.
	const skeleton = await buildGuideSkeleton({
		diff,
		projectId,
		services: grounding,
	});
	const baseline = deriveBaselineFindings({ guide: skeleton });

	const localAi = session
		? await runLocalAiFindings({ raw, diff, session, signal })
		: [];

	const findings: Finding[] = [...baseline, ...localAi];
	const report: FindingsReport = {
		findings,
		prNumber: diff.prNumber,
		headSha: diff.headSha,
		enriched: localAi.length > 0,
		baselineOnly: session === null,
	};

	// Persist only when we actually have a head SHA to key on (an empty fetch
	// yields headSha ""); a missing SHA means the diff couldn't resolve.
	if (cache && report.headSha.length > 0) {
		cache.put({ projectId, prNumber, headSha: report.headSha, report });
	}

	return report;
}

// ---------------------------------------------------------------------------
// tRPC-facing entry points (assemble the ports from the host context)
// ---------------------------------------------------------------------------

export interface ReviewPrInput {
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
 * Host-facing `reviewPr`: wires M1's `fetchPrDiff` and the findings cache into
 * {@link reviewPrCore}. The `prReview.reviewPr` MUTATION calls this.
 */
export async function reviewPr(input: ReviewPrInput): Promise<FindingsReport> {
	const { db, fetchDeps, grounding, session, projectId, prNumber, signal } =
		input;

	return reviewPrCore({
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
			put: ({ projectId: pid, prNumber: pr, headSha, report }) =>
				putFindings({ db, projectId: pid, prNumber: pr, headSha, report }),
		},
	});
}

/**
 * Host-facing `getCachedFindings`: reads the current cached findings for a PR
 * (the renderer calls this on open — it NEVER reviews). Returns
 * `{ report, stale }` or null when nothing is cached.
 */
export function getCachedFindings(input: {
	db: HostDb;
	projectId: string;
	prNumber: number;
}): { report: FindingsReport; stale: boolean } | null {
	const current = getCurrentFindings({
		db: input.db,
		projectId: input.projectId,
		prNumber: input.prNumber,
	});
	if (!current) return null;
	return { report: current.report, stale: current.stale };
}
