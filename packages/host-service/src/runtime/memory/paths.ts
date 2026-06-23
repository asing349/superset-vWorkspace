import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * On-disk roots for Superset Memory (Part B). The SQLite metadata lives in the
 * host db; these paths are for the FUTURE on-disk artifacts — the Obsidian
 * vault (B6) and the lexical/vector index (B3/B7). B1 only establishes the
 * constants + an ensure-dir helper; nothing writes the vault/index yet.
 *
 * Mirrors the rest of host-service: honor `SUPERSET_HOME_DIR` first (used by
 * tests to redirect `~/.superset`), else `~/.superset`.
 */
export function getSupersetHomeDir(): string {
	return process.env.SUPERSET_HOME_DIR?.trim() || join(homedir(), ".superset");
}

/** Root of the memory subsystem's on-disk state: `~/.superset/memory/`. */
export function getMemoryRootDir(): string {
	return join(getSupersetHomeDir(), "memory");
}

/** The Obsidian Markdown vault (B6): `~/.superset/memory/vault/`. */
export function getMemoryVaultDir(): string {
	return join(getMemoryRootDir(), "vault");
}

/** The lexical/vector index (B3/B7): `~/.superset/memory/index/`. */
export function getMemoryIndexDir(): string {
	return join(getMemoryRootDir(), "index");
}

/**
 * Ensure the memory root exists. Idempotent (`recursive: true`). Callers can
 * use this before writing the vault/index in later milestones; B1 calls it so
 * the directory is present once the subsystem is touched.
 */
export function ensureMemoryRootDir(): string {
	const dir = getMemoryRootDir();
	mkdirSync(dir, { recursive: true });
	return dir;
}
