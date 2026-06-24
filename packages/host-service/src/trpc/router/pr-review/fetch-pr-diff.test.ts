import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import simpleGit, { type SimpleGit } from "simple-git";
import type { HostDb } from "../../../db/index.ts";
import * as schema from "../../../db/schema";
import { projects } from "../../../db/schema";
import type { GitFactory } from "../../../runtime/git";
import { fetchPrDiff, type PrDiffResult } from "./fetch-pr-diff";

/**
 * M1 contract test. `fetchPrDiff` is the reusable core the `prReview.getDiff`
 * query wraps. Two paths, one shape:
 *  - the GitHub path (mocked Octokit `pulls.get` + paginated `pulls.listFiles`)
 *    → the `PrDiffFile[]` contract (raw patches, rename `previousFilename`,
 *    null patch for binary/large files) + `body` / `baseBranch` / `headSha`.
 *  - the local-repo fallback (`git fetch refs/pull/<n>/head` + `git diff
 *    base...head`) producing the SAME shape for a PR not checked out locally.
 *  - graceful empty result when the project / PR can't be resolved.
 */

const MIGRATIONS_FOLDER = join(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** A GitFactory that wraps `simple-git` at the given path (no credentials). */
const testGitFactory: GitFactory = async (path: string) => simpleGit(path);

/** A `github()` factory that throws — proves the fallback path never calls it. */
const throwingGithub = (): Promise<Octokit> => {
	throw new Error("github() must not be called on the local-fallback path");
};

describe("fetchPrDiff — GitHub path (mocked Octokit)", () => {
	let db: HostDb;
	const projectId = "proj-gh";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects)
			.values({
				id: projectId,
				repoPath: "/tmp/does-not-matter",
				repoProvider: "github",
				repoOwner: "acme",
				repoName: "widget",
			})
			.run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("maps listFiles patches onto the PrDiffFile[] shape + carries body/base/head", async () => {
		const getCalls: unknown[] = [];
		const listFilesArg = { sentinel: "listFiles" };

		const fakeOctokit = {
			rest: {
				pulls: {
					get: async (args: unknown) => {
						getCalls.push(args);
						return {
							data: {
								number: 42,
								body: "PR body text",
								base: { ref: "main" },
								head: { sha: "deadbeefcafe" },
							},
						};
					},
					// `paginate` is called with this function reference; our fake
					// `paginate` ignores it and returns the canned file list.
					listFiles: listFilesArg,
				},
			},
			paginate: async (route: unknown) => {
				expect(route).toBe(listFilesArg);
				return [
					{
						filename: "src/added.ts",
						status: "added",
						patch: "@@ -0,0 +1,2 @@\n+const a = 1;\n+export { a };",
						additions: 2,
						deletions: 0,
					},
					{
						filename: "src/new-name.ts",
						status: "renamed",
						patch: "@@ -1,1 +1,1 @@\n-old\n+new",
						additions: 1,
						deletions: 1,
						previous_filename: "src/old-name.ts",
					},
					{
						// Binary / large file → GitHub omits `patch`.
						filename: "assets/logo.png",
						status: "modified",
						additions: 0,
						deletions: 0,
					},
				];
			},
		} as unknown as Octokit;

		const result: PrDiffResult = await fetchPrDiff({
			db,
			github: async () => fakeOctokit,
			git: testGitFactory,
			projectId,
			prNumber: 42,
		});

		expect(getCalls).toEqual([
			{ owner: "acme", repo: "widget", pull_number: 42 },
		]);
		expect(result.body).toBe("PR body text");
		expect(result.baseBranch).toBe("main");
		expect(result.headSha).toBe("deadbeefcafe");
		expect(result.prNumber).toBe(42);

		expect(result.files).toEqual([
			{
				filename: "src/added.ts",
				status: "added",
				patch: "@@ -0,0 +1,2 @@\n+const a = 1;\n+export { a };",
				additions: 2,
				deletions: 0,
			},
			{
				filename: "src/new-name.ts",
				status: "renamed",
				patch: "@@ -1,1 +1,1 @@\n-old\n+new",
				additions: 1,
				deletions: 1,
				previousFilename: "src/old-name.ts",
			},
			{
				filename: "assets/logo.png",
				status: "modified",
				patch: null,
				additions: 0,
				deletions: 0,
			},
		]);
	});

	it("normalizes a missing PR body to null", async () => {
		const fakeOctokit = {
			rest: {
				pulls: {
					get: async () => ({
						data: {
							body: null,
							base: { ref: "develop" },
							head: { sha: "abc" },
						},
					}),
					listFiles: {},
				},
			},
			paginate: async () => [],
		} as unknown as Octokit;

		const result = await fetchPrDiff({
			db,
			github: async () => fakeOctokit,
			git: testGitFactory,
			projectId,
			prNumber: 7,
		});

		expect(result.body).toBeNull();
		expect(result.baseBranch).toBe("develop");
		expect(result.files).toEqual([]);
	});
});

describe("fetchPrDiff — local fallback (PR not checked out)", () => {
	let db: HostDb;
	let tmpDirs: string[];
	const projectId = "proj-local";

	beforeEach(() => {
		db = buildDb();
		tmpDirs = [];
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
		for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	});

	function mkTmp(prefix: string): string {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		tmpDirs.push(dir);
		return dir;
	}

	async function configure(git: SimpleGit): Promise<void> {
		await git.raw(["config", "user.email", "test@superset.local"]);
		await git.raw(["config", "user.name", "Test Runner"]);
		await git.raw(["config", "commit.gpgsign", "false"]);
	}

	it("git-fetches refs/pull/<n>/head and builds raw per-file patches", async () => {
		// 1. A bare "origin" remote that publishes the PR head at
		//    refs/pull/3/head — exactly how GitHub exposes PR heads.
		const remotePath = mkTmp("pr-review-remote-");
		const remoteGit = simpleGit(remotePath);
		await remoteGit.init(["--bare", "--initial-branch=main"]);

		// 2. An authoring clone: commit `main`, branch, change a file, then push
		//    that branch to the remote's refs/pull/3/head ref.
		const authorPath = mkTmp("pr-review-author-");
		const authorGit = simpleGit(authorPath);
		await authorGit.init(["--initial-branch=main"]);
		await configure(authorGit);
		await writeFile(join(authorPath, "app.ts"), "export const v = 1;\n");
		await authorGit.add(".");
		await authorGit.commit("base commit");
		await authorGit.addRemote("origin", remotePath);
		await authorGit.push(["-u", "origin", "main"]);

		await authorGit.checkoutLocalBranch("feature");
		await writeFile(
			join(authorPath, "app.ts"),
			"export const v = 1;\nexport const w = 2;\n",
		);
		await writeFile(
			join(authorPath, "added.ts"),
			"export const added = true;\n",
		);
		await authorGit.add(".");
		await authorGit.commit("feature changes");
		const headSha = (await authorGit.revparse(["HEAD"])).trim();
		await authorGit.push(["origin", "HEAD:refs/pull/3/head"]);

		// 3. A "consumer" clone (the host's local project repo) that has `main`
		//    but NOT the feature branch — the PR is NOT checked out here.
		const consumerPath = mkTmp("pr-review-consumer-");
		const consumerGit = simpleGit(consumerPath);
		await consumerGit.clone(remotePath, consumerPath);
		await configure(consumerGit);

		db.insert(projects)
			.values({
				id: projectId,
				repoPath: consumerPath,
				// No github identity → forces the local fallback path.
				remoteName: "origin",
			})
			.run();

		const result = await fetchPrDiff({
			db,
			github: throwingGithub,
			git: testGitFactory,
			projectId,
			prNumber: 3,
		});

		expect(result.headSha).toBe(headSha);
		expect(result.prNumber).toBe(3);
		expect(result.baseBranch).toBe("main");

		const byName = new Map(result.files.map((f) => [f.filename, f]));
		expect([...byName.keys()].sort()).toEqual(["added.ts", "app.ts"]);

		const added = byName.get("added.ts");
		expect(added?.status).toBe("added");
		expect(added?.patch).toContain("+export const added = true;");

		const modified = byName.get("app.ts");
		expect(modified?.status).toBe("modified");
		expect(modified?.patch).toContain("+export const w = 2;");
		expect(modified?.additions).toBeGreaterThan(0);
	});
});

describe("fetchPrDiff — graceful empty", () => {
	it("returns an empty typed result when the project is unknown", async () => {
		const db = buildDb();
		try {
			const result = await fetchPrDiff({
				db,
				github: throwingGithub,
				git: testGitFactory,
				projectId: "missing",
				prNumber: 1,
			});
			expect(result).toEqual({
				files: [],
				body: null,
				baseBranch: "",
				headSha: "",
				prNumber: 1,
			});
		} finally {
			(db as unknown as { $client?: { close: () => void } }).$client?.close();
		}
	});
});
