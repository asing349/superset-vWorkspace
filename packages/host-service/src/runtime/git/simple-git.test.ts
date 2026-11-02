import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SIMPLE_GIT_UNSAFE_OPTION_FLAGS,
	USER_GIT_ENV_SIMPLE_GIT_OPTIONS,
} from "@superset/shared/simple-git-options";
import { type SimpleGit, simpleGit } from "simple-git";
import { createGitFactory } from "./git";
import { createUserSimpleGit } from "./simple-git";

function makeBlockedGitEnv(workRoot: string): Record<string, string> {
	const globalConfig = join(workRoot, "global.gitconfig");
	const systemConfig = join(workRoot, "system.gitconfig");
	const configFile = join(workRoot, "gitconfig");
	const templateDir = join(workRoot, "template");
	mkdirSync(templateDir);
	writeFileSync(globalConfig, "");
	writeFileSync(systemConfig, "");
	writeFileSync(configFile, "");

	return {
		EDITOR: "true",
		VISUAL: "true",
		GIT_ASKPASS: "/bin/echo",
		GIT_CONFIG: configFile,
		GIT_CONFIG_COUNT: "0",
		GIT_CONFIG_GLOBAL: globalConfig,
		GIT_CONFIG_SYSTEM: systemConfig,
		GIT_EDITOR: "true",
		GIT_EXEC_PATH: execSync("git --exec-path", { encoding: "utf8" }).trim(),
		GIT_EXTERNAL_DIFF: "true",
		GIT_PAGER: "cat",
		GIT_PROXY_COMMAND: "true",
		GIT_SEQUENCE_EDITOR: "true",
		GIT_SSH: "ssh",
		GIT_SSH_COMMAND: "ssh",
		GIT_TEMPLATE_DIR: templateDir,
		PAGER: "cat",
		PREFIX: workRoot,
		SSH_ASKPASS: "/bin/echo",
	};
}

async function expectUnsafeEnvRejected(git: SimpleGit): Promise<void> {
	try {
		await git.raw(["status", "--short"]);
	} catch (err) {
		expect(String(err)).toContain("not permitted without enabling allowUnsafe");
		return;
	}

	throw new Error("Expected simple-git to reject unsafe git environment");
}

describe("createUserSimpleGit", () => {
	let workRoot: string;

	beforeEach(() => {
		workRoot = mkdtempSync(join(tmpdir(), "superset-host-simple-git-"));
	});

	afterEach(() => {
		rmSync(workRoot, { recursive: true, force: true });
	});

	test("enables every simple-git unsafe compatibility flag", () => {
		for (const flag of SIMPLE_GIT_UNSAFE_OPTION_FLAGS) {
			expect(USER_GIT_ENV_SIMPLE_GIT_OPTIONS.unsafe[flag]).toBe(true);
		}
	});

	test("rejects the same env without the unsafe allow-list", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });

		await expectUnsafeEnvRejected(
			simpleGit(repoPath).env(makeBlockedGitEnv(workRoot)),
		);
	});

	test("allows user git env variables that simple-git blocks by default", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });

		const git = createUserSimpleGit(repoPath, makeBlockedGitEnv(workRoot));

		const status = await git.raw(["status", "--short"]);
		expect(status).toBe("");
	});
	test("preserves indexed config, operational variables and user editor environment", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...makeBlockedGitEnv(workRoot),
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "superset.migration",
			GIT_CONFIG_VALUE_0: "preserved",
			GIT_OPTIONAL_LOCKS: "0",
		};
		delete env.GIT_CONFIG;
		const git = createUserSimpleGit(repoPath, env);
		expect(
			(await git.raw(["config", "--get", "superset.migration"])).trim(),
		).toBe("preserved");
		expect((await git.raw(["var", "GIT_EDITOR"])).trim()).toBe("true");
		expect(await git.raw(["status", "--short"])).toBe("");
	});

	test("keeps the patched trailer command guard enabled", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });
		const git = createUserSimpleGit(repoPath);
		await expect(
			Promise.resolve(
				git.raw(["-c", "trailer.superset.command=true", "status", "--short"]),
			),
		).rejects.toThrow("allowUnsafeCommandBinaries");
	});

	test("default v4 client blocks VISUAL unless explicitly permitted", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });
		await expect(
			Promise.resolve(
				simpleGit(repoPath)
					.env({ ...process.env, VISUAL: "true" })
					.raw(["status", "--short"]),
			),
		).rejects.toThrow("allowUnsafeEditor");
	});
	test("factory carries refreshed credential and operational environment into v4", async () => {
		const repoPath = join(workRoot, "repo");
		mkdirSync(repoPath);
		execSync("git init", { cwd: repoPath, stdio: "ignore" });
		await createUserSimpleGit(repoPath).raw([
			"remote",
			"add",
			"origin",
			"https://example.invalid/repository.git",
		]);
		const remotes: (string | null)[] = [];
		const factory = createGitFactory({
			getToken: async () => null,
			getCredentials: async (remoteUrl) => {
				remotes.push(remoteUrl);
				return {
					env: {
						GIT_CONFIG_COUNT: "1",
						GIT_CONFIG_KEY_0: "superset.credentials",
						GIT_CONFIG_VALUE_0: remoteUrl ? "refreshed" : "initial",
						GIT_TERMINAL_PROMPT: "0",
					},
				};
			},
		});
		const git = await factory(repoPath);
		expect(remotes).toEqual([null, "https://example.invalid/repository.git"]);
		expect(
			(await git.raw(["config", "--get", "superset.credentials"])).trim(),
		).toBe("refreshed");
		expect(await git.raw(["status", "--short"])).toBe("");
	});
});
