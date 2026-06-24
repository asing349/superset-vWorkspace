import type { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../../db";
import { projects } from "../../../db/schema";
import type { GitFactory } from "../../../runtime/git";
import {
	getChangedFilesForDiff,
	resolveBaseComparison,
} from "../git/utils/git-helpers";

/**
 * `prReview` core — Wave 5, M1. The arbitrary-PR diff SOURCE: given a
 * `(projectId, prNumber)`, return the PR's `base..head` multi-file diff plus
 * the PR `body` / `baseBranch` / `headSha`, for a PR that may NOT be checked
 * out locally.
 *
 * Two paths, same shape:
 *  (a) GitHub — `octokit.rest.pulls.get` (body/base.ref/head.sha) +
 *      `octokit.rest.pulls.listFiles` (paginated; per-file unified-diff
 *      `patch`). This is the primary path and works for any repo PR.
 *  (b) Local fallback — when the GitHub path can't be used (no Octokit / no
 *      remote identity) but the project's repo is on disk, `git fetch` the PR
 *      head ref + `git diff base...head` to produce the SAME shape.
 *
 * The HOST returns RAW unified-diff patch strings (NOT parsed diff items):
 * `@pierre/diffs` `parseDiffFromFile` is a renderer-only dependency (confirmed:
 * it is NOT a dependency of `packages/host-service`), so the renderer (window)
 * parses the raw patches and the guide (M3/M4) reads filenames + patches for
 * grounding. This keeps the host egress-bounded to fetching PR data only.
 */

/**
 * One file's changes in a PR diff. The `patch` is the RAW unified-diff string
 * exactly as GitHub's `pulls/{n}/files` returns it (or as `git diff` produces
 * for the local-fallback path) — the renderer runs `parseDiffFromFile` on it.
 * `patch` is `null` for files GitHub omits a patch for (e.g. binary files or
 * very large diffs).
 */
export interface PrDiffFile {
	filename: string;
	status: string;
	patch: string | null;
	additions: number;
	deletions: number;
	previousFilename?: string;
}

/**
 * The fixed `getDiff` / `fetchPrDiff` contract. The renderer (window) derives
 * this via `inferRouterOutputs<AppRouter>["prReview"]["getDiff"]`; the guide
 * (M3/M4) reads `files[].filename` + `files[].patch` for grounding. Do not
 * diverge from this shape without telling the orchestrator.
 */
export interface PrDiffResult {
	files: PrDiffFile[];
	body: string | null;
	baseBranch: string;
	headSha: string;
	prNumber: number;
}

/**
 * Dependencies the core needs, threaded explicitly so it is unit-testable with
 * a mocked Octokit + an in-memory DB (no tRPC context required). The router
 * supplies these from `ctx`.
 */
export interface FetchPrDiffDeps {
	db: HostDb;
	/** The Octokit factory the PR runtime already uses (`ctx.github`). */
	github: () => Promise<Octokit>;
	/** The host git factory (`ctx.git`) — used only by the local fallback. */
	git: GitFactory;
}

export interface FetchPrDiffOptions extends FetchPrDiffDeps {
	projectId: string;
	prNumber: number;
}

/** Local row shape we read off the `projects` table. */
type ProjectRow = typeof projects.$inferSelect;

function loadProject(db: HostDb, projectId: string): ProjectRow | undefined {
	return db.query.projects
		.findFirst({ where: eq(projects.id, projectId) })
		.sync();
}

/**
 * Resolve the repo's GitHub `(owner, name)` identity from the project row.
 * Returns null when the project has no recorded GitHub remote — the caller
 * then attempts the local fallback.
 */
function resolveRepoIdentity(
	project: ProjectRow,
): { owner: string; name: string } | null {
	if (
		project.repoProvider === "github" &&
		project.repoOwner &&
		project.repoName
	) {
		return { owner: project.repoOwner, name: project.repoName };
	}
	return null;
}

/**
 * Map a single `pulls/{n}/files` entry onto a {@link PrDiffFile}. GitHub's
 * response is snake_case on the wire (`previous_filename`); Octokit's typed
 * surface keeps it snake_case, so we read it directly. `patch` is optional in
 * the response → normalized to `null`.
 */
function toPrDiffFile(file: {
	filename: string;
	status: string;
	patch?: string;
	additions: number;
	deletions: number;
	previous_filename?: string;
}): PrDiffFile {
	const base: PrDiffFile = {
		filename: file.filename,
		status: file.status,
		patch: file.patch ?? null,
		additions: file.additions,
		deletions: file.deletions,
	};
	if (file.previous_filename) {
		base.previousFilename = file.previous_filename;
	}
	return base;
}

/**
 * Fetch the PR's diff via the GitHub REST API. Throws on any GitHub failure so
 * the caller can fall back to the local path; never returns a partial result.
 */
async function fetchFromGitHub({
	octokit,
	owner,
	name,
	prNumber,
}: {
	octokit: Octokit;
	owner: string;
	name: string;
	prNumber: number;
}): Promise<PrDiffResult> {
	const pr = await octokit.rest.pulls.get({
		owner,
		repo: name,
		pull_number: prNumber,
	});

	// Paginate so PRs with >30 changed files return every file's patch.
	const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
		owner,
		repo: name,
		pull_number: prNumber,
		per_page: 100,
	});

	return {
		files: files.map(toPrDiffFile),
		body: pr.data.body ?? null,
		baseBranch: pr.data.base.ref,
		headSha: pr.data.head.sha,
		prNumber,
	};
}

// A PR head is published on the origin remote at `refs/pull/<n>/head`.
function prHeadRef(prNumber: number): string {
	return `refs/pull/${prNumber}/head`;
}

/**
 * Local-fallback path: `git fetch` the PR head ref, then build per-file RAW
 * unified-diff patches via `git diff <base>...<headSha>`. Produces the SAME
 * {@link PrDiffResult} shape as the GitHub path. Best-effort — a fetch/diff
 * failure surfaces as a thrown error the caller turns into a graceful empty
 * result.
 */
async function fetchFromLocalRepo({
	git,
	repoPath,
	remoteName,
	prNumber,
}: {
	git: GitFactory;
	repoPath: string;
	remoteName: string;
	prNumber: number;
}): Promise<PrDiffResult> {
	const repo = await git(repoPath);

	// Fetch the PR head into a local tracking ref so we can diff against it even
	// when the PR isn't checked out. FETCH_HEAD carries the just-fetched commit.
	await repo.raw(["fetch", remoteName, prHeadRef(prNumber)]);
	const headSha = (await repo.raw(["rev-parse", "FETCH_HEAD"])).trim();

	// Resolve the base branch the PR targets (the repo default branch's
	// configured upstream) and the merge base, matching the 3-dot semantics the
	// Changes view uses.
	const base = await resolveBaseComparison(repo);
	const baseRef = base?.baseRef ?? "HEAD";
	const baseBranch = base?.branchName ?? "";
	const mergeBase = await repo
		.raw(["merge-base", baseRef, headSha])
		.then((s) => s.trim())
		.catch(() => baseRef);

	// Per-file status + line stats (reuses the git router's helper).
	const changed = await getChangedFilesForDiff(repo, [
		`${mergeBase}...${headSha}`,
	]);

	const files: PrDiffFile[] = await Promise.all(
		changed.map(async (file): Promise<PrDiffFile> => {
			// Raw unified-diff patch for this one path. `--` disambiguates the
			// pathspec; a failure yields a null patch rather than aborting the diff.
			const patch = await repo
				.raw(["diff", `${mergeBase}...${headSha}`, "--", file.path])
				.then((s) => s.trim() || null)
				.catch(() => null);
			const entry: PrDiffFile = {
				filename: file.path,
				status: file.status,
				patch,
				additions: file.additions,
				deletions: file.deletions,
			};
			if (file.oldPath) entry.previousFilename = file.oldPath;
			return entry;
		}),
	);

	return {
		files,
		body: null,
		baseBranch,
		headSha,
		prNumber,
	};
}

/**
 * Reusable core: fetch the `base..head` diff of any repo PR (checked out or
 * not), plus its `body` / `baseBranch` / `headSha`. Tries GitHub first (the
 * primary, fully-featured path), then the local repo fallback. Best-effort and
 * non-throwing: when neither path can resolve the PR, returns an empty-but-typed
 * result (empty `files`, `null` body, empty `baseBranch`, empty `headSha`) so
 * the renderer degrades gracefully instead of crashing.
 */
export async function fetchPrDiff(
	options: FetchPrDiffOptions,
): Promise<PrDiffResult> {
	const { db, github, git, projectId, prNumber } = options;

	const empty: PrDiffResult = {
		files: [],
		body: null,
		baseBranch: "",
		headSha: "",
		prNumber,
	};

	const project = loadProject(db, projectId);
	if (!project) return empty;

	const identity = resolveRepoIdentity(project);

	// (a) GitHub path — primary. Requires a recorded GitHub remote identity.
	if (identity) {
		try {
			const octokit = await github();
			return await fetchFromGitHub({
				octokit,
				owner: identity.owner,
				name: identity.name,
				prNumber,
			});
		} catch (error) {
			console.warn(
				"[host-service:pr-review] GitHub PR diff fetch failed; attempting local fallback",
				{ projectId, prNumber, error },
			);
		}
	}

	// (b) Local fallback — `git fetch` the PR head + `git diff base...head`.
	if (project.repoPath) {
		try {
			return await fetchFromLocalRepo({
				git,
				repoPath: project.repoPath,
				remoteName: project.remoteName ?? "origin",
				prNumber,
			});
		} catch (error) {
			console.warn(
				"[host-service:pr-review] Local PR diff fallback failed; returning empty diff",
				{ projectId, prNumber, error },
			);
		}
	}

	return empty;
}
