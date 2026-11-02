import {
	type ExecFileOptionsWithStringEncoding,
	execFile,
} from "node:child_process";
import { promisify } from "node:util";
import { getUserGitEnvironmentOptions } from "@superset/shared/simple-git-options";
import { type SimpleGit, type SimpleGitOptions, simpleGit } from "simple-git";
import { getProcessEnvWithShellPath } from "./shell-env";

const execFileAsync = promisify(execFile);

export async function getSimpleGitWithShellPath(
	repoPath?: string,
): Promise<SimpleGit> {
	const env = await getProcessEnvWithShellPath();
	const options = getUserGitEnvironmentOptions(
		env,
	) satisfies Partial<SimpleGitOptions>;
	return (repoPath ? simpleGit(repoPath, options) : simpleGit(options)).env(
		env,
	);
}

export async function execGitWithShellPath(
	args: string[],
	options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
	const env = await getProcessEnvWithShellPath(
		options?.env ? { ...process.env, ...options.env } : process.env,
	);

	return execFileAsync("git", args, {
		...options,
		encoding: "utf8",
		env,
	});
}
