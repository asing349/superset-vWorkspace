export const SIMPLE_GIT_UNSAFE_OPTION_FLAGS = [
	"allowUnsafeAlias",
	"allowUnsafeAskPass",
	"allowUnsafeConfigEnvCount",
	"allowUnsafeConfigPaths",
	"allowUnsafeCredentialHelper",
	"allowUnsafeCustomBinary",
	"allowUnsafeDiffExternal",
	"allowUnsafeDiffTextConv",
	"allowUnsafeEditor",
	"allowUnsafeFilter",
	"allowUnsafeFsMonitor",
	"allowUnsafeGitProxy",
	"allowUnsafeGpgProgram",
	"allowUnsafeHooksPath",
	"allowUnsafeMergeDriver",
	"allowUnsafePack",
	"allowUnsafePager",
	"allowUnsafeProtocolOverride",
	"allowUnsafeSshCommand",
	"allowUnsafeTemplateDir",
] as const;

export type SimpleGitUnsafeOptionFlag =
	(typeof SIMPLE_GIT_UNSAFE_OPTION_FLAGS)[number];

export const USER_GIT_ENV_SIMPLE_GIT_OPTIONS = {
	unsafe: Object.fromEntries(
		SIMPLE_GIT_UNSAFE_OPTION_FLAGS.map((flag) => [flag, true]),
	),
} as {
	unsafe: Record<SimpleGitUnsafeOptionFlag, true>;
};

/** Preserve only the environment supplied by this local Git client. New v4
 * command guards (for example trailer command injection) stay enabled. */
export function getUserGitEnvironmentOptions(
	env: Record<string, string | undefined> = process.env,
) {
	return {
		...USER_GIT_ENV_SIMPLE_GIT_OPTIONS,
		allowEnvironment: Object.keys(env),
		unsafe: {
			...USER_GIT_ENV_SIMPLE_GIT_OPTIONS.unsafe,
			// v4 classifies a user-selected Git executable directory separately.
			allowUnsafeExec: Object.entries(env).some(
				([key, value]) => key.toUpperCase() === "GIT_EXEC_PATH" && !!value,
			),
		},
	};
}
