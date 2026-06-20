import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects, workspaces } from "../../db/schema";
import {
	getGroupAgentRootPath,
	getSupersetHomeDir,
	prepareAgentRoot,
	prepareAgentRootSerialized,
} from "./prepare-agent-root.ts";
import { WorkspaceGroupResolver } from "./resolve.ts";
import {
	createInMemoryWorkspaceGroupStore,
	type WorkspaceGroupStore,
} from "./store.ts";
import type { ResolvedWorkspaceGroupRoot } from "./types.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

const GROUP_ID = "group-abc";

function makeRoot(
	overrides: Partial<ResolvedWorkspaceGroupRoot> &
		Pick<ResolvedWorkspaceGroupRoot, "rootId" | "label" | "rootPath">,
): ResolvedWorkspaceGroupRoot {
	return {
		kind: "folder",
		workspaceId: null,
		folderPath: overrides.rootPath,
		position: 0,
		exists: true,
		...overrides,
	};
}

/** Symlink names present in the agent root, sorted for stable assertions. */
function linkNames(agentRootPath: string): string[] {
	return readdirSync(agentRootPath).sort();
}

describe("prepareAgentRoot", () => {
	let homeDir: string;
	let targetsDir: string;
	let prevHomeEnv: string | undefined;

	beforeEach(() => {
		// Point the ~/.superset base dir at a temp dir via SUPERSET_HOME_DIR so the
		// synthetic parent lands somewhere disposable (and we exercise the same
		// base-dir resolution the rest of host-service uses).
		homeDir = mkdtempSync(join(tmpdir(), "prepare-agent-root-home-"));
		targetsDir = mkdtempSync(join(tmpdir(), "prepare-agent-root-targets-"));
		prevHomeEnv = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHomeEnv === undefined) {
			delete process.env.SUPERSET_HOME_DIR;
		} else {
			process.env.SUPERSET_HOME_DIR = prevHomeEnv;
		}
		rmSync(homeDir, { recursive: true, force: true });
		rmSync(targetsDir, { recursive: true, force: true });
	});

	function makeTargetDir(name: string): string {
		const path = join(targetsDir, name);
		mkdirSync(path, { recursive: true });
		return path;
	}

	it("honors SUPERSET_HOME_DIR for the agent root base path", () => {
		expect(getSupersetHomeDir()).toBe(homeDir);
		expect(getGroupAgentRootPath(GROUP_ID)).toBe(
			join(homeDir, "group-roots", GROUP_ID),
		);
	});

	it("reconciles links across add/remove and skips missing-target roots", () => {
		const pathA = makeTargetDir("repo-a");
		const pathB = makeTargetDir("repo-b");

		// 1. Initial prepare with two present roots.
		const first = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({ rootId: "b", label: "beta", rootPath: pathB }),
			],
		});
		expect(linkNames(first.agentRootPath)).toEqual(["alpha", "beta"]);
		expect(readlinkSync(join(first.agentRootPath, "alpha"))).toBe(pathA);
		expect(readlinkSync(join(first.agentRootPath, "beta"))).toBe(pathB);
		expect(first.skippedRootIds).toEqual([]);

		// 2. Add a third root; re-run adds only the new link.
		const pathC = makeTargetDir("repo-c");
		const second = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({ rootId: "b", label: "beta", rootPath: pathB }),
				makeRoot({ rootId: "c", label: "gamma", rootPath: pathC }),
			],
		});
		expect(linkNames(second.agentRootPath)).toEqual(["alpha", "beta", "gamma"]);
		expect(readlinkSync(join(second.agentRootPath, "gamma"))).toBe(pathC);

		// 3. Remove a root; re-run removes the stale link.
		const third = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({ rootId: "c", label: "gamma", rootPath: pathC }),
			],
		});
		expect(linkNames(third.agentRootPath)).toEqual(["alpha", "gamma"]);

		// 4. A root whose target doesn't exist is skipped, never crashing.
		const fourth = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({
					rootId: "x",
					label: "ghost",
					rootPath: join(targetsDir, "does-not-exist"),
					exists: false,
				}),
			],
		});
		expect(linkNames(fourth.agentRootPath)).toEqual(["alpha"]);
		expect(fourth.skippedRootIds).toEqual(["x"]);
		expect(
			lstatSync(join(fourth.agentRootPath, "alpha")).isSymbolicLink(),
		).toBe(true);
	});

	it("de-duplicates colliding labels as name, name-2, name-3", () => {
		const pathA = makeTargetDir("dup-a");
		const pathB = makeTargetDir("dup-b");
		const pathC = makeTargetDir("dup-c");

		const result = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [
				makeRoot({ rootId: "a", label: "repo", rootPath: pathA }),
				makeRoot({ rootId: "b", label: "repo", rootPath: pathB }),
				makeRoot({ rootId: "c", label: "repo", rootPath: pathC }),
			],
		});

		expect(result.linkedRootNames).toEqual(["repo", "repo-2", "repo-3"]);
		expect(linkNames(result.agentRootPath)).toEqual([
			"repo",
			"repo-2",
			"repo-3",
		]);
		expect(readlinkSync(join(result.agentRootPath, "repo"))).toBe(pathA);
		expect(readlinkSync(join(result.agentRootPath, "repo-2"))).toBe(pathB);
		expect(readlinkSync(join(result.agentRootPath, "repo-3"))).toBe(pathC);
	});

	it("re-points a link whose target drifted (same label, new path)", () => {
		const pathA = makeTargetDir("drift-a");
		const first = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [makeRoot({ rootId: "a", label: "root", rootPath: pathA })],
		});
		expect(readlinkSync(join(first.agentRootPath, "root"))).toBe(pathA);

		const pathANew = makeTargetDir("drift-a-new");
		const second = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [makeRoot({ rootId: "a", label: "root", rootPath: pathANew })],
		});
		expect(readlinkSync(join(second.agentRootPath, "root"))).toBe(pathANew);
		expect(linkNames(second.agentRootPath)).toEqual(["root"]);
	});

	it("sanitizes labels into a single safe path segment", () => {
		const path = makeTargetDir("weird");
		const result = prepareAgentRoot({
			groupId: GROUP_ID,
			roots: [makeRoot({ rootId: "a", label: "../../etc", rootPath: path })],
		});
		// Path separators are stripped, leading dots removed — the link can't
		// escape the synthetic parent dir.
		expect(result.linkedRootNames).toHaveLength(1);
		const name = result.linkedRootNames[0] as string;
		expect(name.includes("/")).toBe(false);
		expect(name.startsWith(".")).toBe(false);
	});

	describe("prepareAgentRootSerialized (per-group concurrency guard)", () => {
		it("serializes concurrent same-group calls and converges to the final root set without error", async () => {
			const pathA = makeTargetDir("conc-a");
			const pathB = makeTargetDir("conc-b");
			const pathC = makeTargetDir("conc-c");

			const rootsAB = [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({ rootId: "b", label: "beta", rootPath: pathB }),
			];
			const rootsAC = [
				makeRoot({ rootId: "a", label: "alpha", rootPath: pathA }),
				makeRoot({ rootId: "c", label: "gamma", rootPath: pathC }),
			];

			// Fire several concurrent prepares for the SAME group with differing root
			// sets. Without serialization their non-atomic readdir/rm/symlink steps
			// could interleave and throw (EEXIST / ENOENT) or leave a corrupt dir.
			const results = await Promise.all([
				prepareAgentRootSerialized({ groupId: GROUP_ID, roots: rootsAB }),
				prepareAgentRootSerialized({ groupId: GROUP_ID, roots: rootsAC }),
				prepareAgentRootSerialized({ groupId: GROUP_ID, roots: rootsAB }),
				prepareAgentRootSerialized({ groupId: GROUP_ID, roots: rootsAC }),
			]);

			// Every call resolved (no race-induced rejection) to the same parent dir.
			const agentRootPath = results[0]?.agentRootPath as string;
			expect(agentRootPath).toBe(getGroupAgentRootPath(GROUP_ID));
			for (const r of results) {
				expect(r.agentRootPath).toBe(agentRootPath);
			}

			// The last-enqueued call (rootsAC) wins; the dir converges to exactly its
			// links, with valid symlinks pointing at the right targets.
			expect(linkNames(agentRootPath)).toEqual(["alpha", "gamma"]);
			expect(readlinkSync(join(agentRootPath, "alpha"))).toBe(pathA);
			expect(readlinkSync(join(agentRootPath, "gamma"))).toBe(pathC);
			expect(lstatSync(join(agentRootPath, "alpha")).isSymbolicLink()).toBe(
				true,
			);
		});

		it("runs different groups in parallel into distinct synthetic dirs", async () => {
			const otherGroup = "group-other";
			const pathA = makeTargetDir("par-a");
			const pathOther = makeTargetDir("par-other");

			const goodA = makeRoot({ rootId: "a", label: "alpha", rootPath: pathA });
			const goodOther = makeRoot({
				rootId: "o",
				label: "omega",
				rootPath: pathOther,
			});

			const [resA, resOther] = await Promise.all([
				prepareAgentRootSerialized({ groupId: GROUP_ID, roots: [goodA] }),
				prepareAgentRootSerialized({ groupId: otherGroup, roots: [goodOther] }),
			]);

			// Different groups get distinct synthetic dirs and both succeed (they are
			// not serialized against each other).
			expect(resA.agentRootPath).toBe(getGroupAgentRootPath(GROUP_ID));
			expect(resOther.agentRootPath).toBe(getGroupAgentRootPath(otherGroup));
			expect(resA.agentRootPath).not.toBe(resOther.agentRootPath);
			expect(linkNames(resA.agentRootPath)).toEqual(["alpha"]);
			expect(linkNames(resOther.agentRootPath)).toEqual(["omega"]);

			// A subsequent same-group call still works after the queue has drained
			// (the map entry is cleaned up rather than leaking).
			const again = await prepareAgentRootSerialized({
				groupId: GROUP_ID,
				roots: [goodA],
			});
			expect(again.agentRootPath).toBe(getGroupAgentRootPath(GROUP_ID));
			expect(linkNames(again.agentRootPath)).toEqual(["alpha"]);
		});
	});

	/**
	 * Wave-2 M9: a `kind: "workspace"` root resolves (via the resolver + a host
	 * `workspaces` row) to that workspace's `worktreePath`, and `prepareAgentRoot`
	 * symlinks the synthetic dir at the WORKTREE PATH (not the workspaceId) —
	 * alongside a `kind: "folder"` root. The wave-1/2 prepare-agent-root tests
	 * above only exercise folder roots (they pass `rootPath` directly); this
	 * block exercises the resolver → prepare composition the combined agent
	 * actually runs for a worktree-backed root, including the skip-missing path
	 * for a workspace whose row was deleted.
	 */
	describe("workspace-root resolution (resolver → prepareAgentRoot)", () => {
		let db: HostDb;
		let store: WorkspaceGroupStore;
		let resolver: WorkspaceGroupResolver;
		let projectId: string;
		let worktreePath: string;
		let folderPath: string;

		beforeEach(() => {
			db = buildDb();
			store = createInMemoryWorkspaceGroupStore();
			resolver = new WorkspaceGroupResolver({ db });

			// A real on-disk worktree dir + a folder dir under the disposable targets.
			worktreePath = makeTargetDir("worktree-feature");
			folderPath = makeTargetDir("plain-folder");

			// Seed a project + a workspaces row whose worktreePath points at the
			// worktree dir, exactly as a created worktree would (seed.ts shape).
			projectId = randomUUID();
			db.insert(projects)
				.values({ id: projectId, repoPath: makeTargetDir("repo-main") })
				.run();
		});

		afterEach(() => {
			(db as unknown as { $client?: { close: () => void } }).$client?.close();
		});

		function seedWorkspaceRow(worktreePathValue: string): string {
			const id = randomUUID();
			db.insert(workspaces)
				.values({
					id,
					projectId,
					worktreePath: worktreePathValue,
					branch: "feature/x",
				})
				.run();
			return id;
		}

		it("symlinks a workspace root at its resolved worktree path, alongside a folder root", () => {
			const workspaceId = seedWorkspaceRow(worktreePath);

			const created = store.create({
				name: "mixed",
				roots: [
					{
						kind: "workspace",
						workspaceId,
						folderPath: null,
						label: "Feature",
					},
					{
						kind: "folder",
						workspaceId: null,
						folderPath,
						label: "Notes",
					},
				],
			});

			const group = store.get(created.id);
			if (!group) throw new Error("expected group to exist");
			const resolved = resolver.resolveGroup(group);

			// The resolver turned the workspaceId into the worktree path…
			const workspaceResolved = resolved.roots.find(
				(r) => r.kind === "workspace",
			);
			expect(workspaceResolved?.rootPath).toBe(worktreePath);
			expect(workspaceResolved?.exists).toBe(true);

			// …and prepareAgentRoot symlinks the synthetic dir at that worktree path,
			// NOT at the workspaceId, beside the folder root's link.
			const result = prepareAgentRoot({
				groupId: created.id,
				roots: resolved.roots,
			});
			expect(linkNames(result.agentRootPath).length).toBe(2);
			expect(result.skippedRootIds).toEqual([]);
			expect(readlinkSync(join(result.agentRootPath, "Feature"))).toBe(
				worktreePath,
			);
			expect(readlinkSync(join(result.agentRootPath, "Notes"))).toBe(
				folderPath,
			);
			expect(
				lstatSync(join(result.agentRootPath, "Feature")).isSymbolicLink(),
			).toBe(true);
		});

		it("skips a workspace root whose workspaces row was deleted, keeping the folder root", () => {
			const workspaceId = seedWorkspaceRow(worktreePath);
			const created = store.create({
				name: "stale-after-delete",
				roots: [
					{
						kind: "workspace",
						workspaceId,
						folderPath: null,
						label: "Feature",
					},
					{
						kind: "folder",
						workspaceId: null,
						folderPath,
						label: "Notes",
					},
				],
			});
			const workspaceRootId = created.roots.find(
				(r) => r.kind === "workspace",
			)?.rootId;
			if (!workspaceRootId) throw new Error("expected a workspace root id");

			// First prepare: both roots present and linked.
			const groupBefore = store.get(created.id);
			if (!groupBefore) throw new Error("expected group to exist");
			const first = prepareAgentRoot({
				groupId: created.id,
				roots: resolver.resolveGroup(groupBefore).roots,
			});
			expect(linkNames(first.agentRootPath).sort()).toEqual([
				"Feature",
				"Notes",
			]);

			// Delete the workspaces row out from under the group. The resolver now
			// resolves the workspace root to "" / exists:false (no throw); a re-run
			// removes the stale link and reports it skipped, leaving the folder root.
			db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
			const groupAfter = store.get(created.id);
			if (!groupAfter) throw new Error("expected group to exist");
			const resolvedAfter = resolver.resolveGroup(groupAfter);
			expect(
				resolvedAfter.roots.find((r) => r.kind === "workspace")?.exists,
			).toBe(false);

			const second = prepareAgentRoot({
				groupId: created.id,
				roots: resolvedAfter.roots,
			});
			expect(linkNames(second.agentRootPath)).toEqual(["Notes"]);
			expect(second.skippedRootIds).toEqual([workspaceRootId]);
		});
	});
});
