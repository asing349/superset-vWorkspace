import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, normalize, sep } from "node:path";
import { getTerminalBaseEnv } from "../../terminal/env";

/** Reuse the host's preserved login-shell environment without spawning a shell. */
export function getCodexProcessEnv(): NodeJS.ProcessEnv {
	try {
		return { ...process.env, ...getTerminalBaseEnv() };
	} catch {
		// Standalone helpers may run before terminal environment initialization.
		return { ...process.env };
	}
}

function executableFile(candidate: string): string | null {
	if (!isAbsolute(candidate)) return null;
	try {
		if (!statSync(candidate).isFile()) return null;
		accessSync(
			candidate,
			process.platform === "win32" ? constants.F_OK : constants.X_OK,
		);
		return realpathSync(candidate);
	} catch {
		return null;
	}
}

/** Match desktop findRealBinary's exclusion of Superset notification wrappers. */
function isSupersetWrapper(candidate: string): boolean {
	const homePrefix = `${normalize(homedir())}${sep}`;
	if (!normalize(candidate).startsWith(homePrefix)) return false;
	const relative = normalize(candidate).slice(homePrefix.length);
	return /^\.superset(?:-[^/\\]+)?[/\\]bin[/\\]/.test(relative);
}

/**
 * Resolve the installed native Codex for both account RPC and agent execution.
 * No installation, login, shell probing or persistent PATH/config changes.
 */
export function resolveCodexExecutable(
	options: {
		env?: NodeJS.ProcessEnv;
		allowSupersetWrappers?: boolean;
	} = {},
): string {
	const env = options.env ?? getCodexProcessEnv();
	const override = env.SUPERSET_CODEX_EXECUTABLE?.trim();
	if (override) {
		const executable = executableFile(override);
		if (!executable)
			throw new Error(
				"SUPERSET_CODEX_EXECUTABLE must name an absolute, executable Codex file.",
			);
		return executable;
	}

	const name = process.platform === "win32" ? "codex.exe" : "codex";
	const paths = [
		env.PATH ?? env.Path ?? "",
		process.env.PATH ?? process.env.Path ?? "",
	];
	for (const path of paths) {
		for (const directory of path.split(delimiter).filter(Boolean)) {
			const candidate = join(directory, name);
			if (!options.allowSupersetWrappers && isSupersetWrapper(candidate))
				continue;
			const executable = executableFile(candidate);
			if (executable) return executable;
		}
	}

	if (process.platform === "darwin") {
		const marker = `${sep}Contents${sep}`;
		const markerIndex = process.execPath.lastIndexOf(marker);
		const enclosingApp =
			markerIndex >= 0 ? process.execPath.slice(0, markerIndex) : "";
		const applicationRoots = ["/Applications", join(homedir(), "Applications")];
		const apps = [
			...(enclosingApp.endsWith(".app") ? [enclosingApp] : []),
			...applicationRoots.flatMap((directory) => [
				join(directory, "ChatGPT.app"),
				join(directory, "Codex.app"),
			]),
		];
		for (const app of apps) {
			for (const relative of [
				"Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
				"Contents/Resources/codex-cli/bin/codex",
				"Contents/Resources/codex",
			]) {
				const executable = executableFile(join(app, relative));
				if (executable) return executable;
			}
		}
	}

	throw new Error(
		"Cannot find local Codex. Install Codex/ChatGPT, put Codex on PATH, or set SUPERSET_CODEX_EXECUTABLE to its absolute native executable path.",
	);
}
