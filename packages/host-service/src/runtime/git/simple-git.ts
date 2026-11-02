import { getUserGitEnvironmentOptions } from "@superset/shared/simple-git-options";
import { type SimpleGit, type SimpleGitOptions, simpleGit } from "simple-git";

// Preserve user Git configuration while retaining v4's command validation.
export function createUserSimpleGit(
	baseDir?: string,
	env: NodeJS.ProcessEnv = process.env,
): SimpleGit {
	const effectiveEnv = { ...process.env, ...env };
	const options = getUserGitEnvironmentOptions(
		effectiveEnv,
	) satisfies Partial<SimpleGitOptions>;
	return (baseDir ? simpleGit(baseDir, options) : simpleGit(options)).env(
		effectiveEnv,
	);
}
