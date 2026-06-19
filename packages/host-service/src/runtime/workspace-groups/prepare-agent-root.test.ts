import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getGroupAgentRootPath,
	getSupersetHomeDir,
	prepareAgentRoot,
} from "./prepare-agent-root.ts";
import type { ResolvedWorkspaceGroupRoot } from "./types.ts";

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
});
