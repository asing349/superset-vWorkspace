import type { AreaTag } from "../types";

/**
 * Path → area mapping (PURE LOGIC). Derives the coarse, MULTI-LABEL area tags
 * for a repo-relative path from the Superset monorepo layout documented in
 * `AGENTS.md`. A single path can match several rules (e.g. a `*.test.ts` file
 * under `packages/host-service/` is both "backend" AND "tests"), so the result
 * is always a set.
 *
 * Data-driven and easily extensible: add a rule to `AREA_RULES` (most specific
 * prefixes first) and, if it is a new category, add the tag to the `AreaTag`
 * union in `../types`. B3/B4 read these tags; B2 stamps them onto Playbooks.
 */

/** A single matching rule: a path prefix that contributes one or more areas. */
interface AreaRule {
	/** Repo-relative prefix to match (POSIX separators, no leading "./"). */
	prefix: string;
	/** Areas this prefix contributes. */
	areas: AreaTag[];
}

/**
 * Prefix → area rules. Order matters only for readability — every matching
 * rule contributes (multi-label). More specific prefixes are listed before the
 * broader package roots they live under.
 */
export const AREA_RULES: readonly AreaRule[] = [
	// Apps
	{ prefix: "apps/web", areas: ["frontend"] },
	{ prefix: "apps/marketing", areas: ["marketing", "frontend"] },
	{ prefix: "apps/admin", areas: ["admin", "frontend"] },
	{ prefix: "apps/api", areas: ["backend"] },
	{ prefix: "apps/desktop", areas: ["desktop"] },
	{ prefix: "apps/docs", areas: ["docs"] },
	{ prefix: "apps/mobile", areas: ["mobile", "frontend"] },
	// Packages
	{ prefix: "packages/host-service", areas: ["backend"] },
	{ prefix: "packages/memory", areas: ["memory", "backend"] },
	{ prefix: "packages/ui", areas: ["design-system", "frontend"] },
	{ prefix: "packages/db", areas: ["schema", "backend"] },
	{ prefix: "packages/auth", areas: ["auth", "backend"] },
	{ prefix: "packages/trpc", areas: ["trpc", "backend"] },
	{ prefix: "packages/mcp", areas: ["mcp", "backend"] },
	{ prefix: "packages/local-db", areas: ["schema", "backend"] },
	{ prefix: "packages/durable-session", areas: ["backend"] },
	{ prefix: "packages/email", areas: ["backend"] },
	{ prefix: "packages/shared", areas: ["shared"] },
	{ prefix: "packages/scripts", areas: ["scripts"] },
	{ prefix: "packages/chat", areas: ["backend"] },
	{ prefix: "packages/workspace-fs", areas: ["backend"] },
	{ prefix: "packages/workspace-client", areas: ["frontend"] },
	{ prefix: "packages/panes", areas: ["frontend"] },
	// Tooling & docs
	{ prefix: "tooling", areas: ["tooling"] },
	{ prefix: "plans", areas: ["docs"] },
	{ prefix: "docs", areas: ["docs"] },
] as const;

/**
 * Filename / path-segment patterns layered ON TOP of the prefix rules, so e.g.
 * a test or a config file is tagged regardless of which package it lives in.
 */
const SECONDARY_RULES: readonly {
	test: (path: string) => boolean;
	area: AreaTag;
}[] = [
	{
		test: (p) => /(?:^|\/)[^/]*\.(?:test|spec)\.[cm]?[tj]sx?$/.test(p),
		area: "tests",
	},
	{ test: (p) => /(?:^|\/)__tests__\//.test(p), area: "tests" },
	{ test: (p) => /(?:^|\/)test\//.test(p), area: "tests" },
	{
		test: (p) =>
			/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|biome\.jsonc|drizzle\.config\.ts|turbo\.json|\.env[^/]*)$/.test(
				p,
			),
		area: "config",
	},
	{ test: (p) => /(?:^|\/)drizzle\//.test(p), area: "schema" },
];

/** Normalize a path to repo-relative POSIX form for matching. */
function normalizePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "");
}

/**
 * Map a single repo-relative path to its set of area tags (multi-label). Never
 * throws and never returns an empty array: an unrecognized path yields
 * `["other"]` so downstream area filters always have something to key on.
 */
export function pathToAreas(path: string): AreaTag[] {
	const normalized = normalizePath(path);
	const areas = new Set<AreaTag>();

	for (const rule of AREA_RULES) {
		if (
			normalized === rule.prefix ||
			normalized.startsWith(`${rule.prefix}/`)
		) {
			for (const area of rule.areas) areas.add(area);
		}
	}
	for (const rule of SECONDARY_RULES) {
		if (rule.test(normalized)) areas.add(rule.area);
	}

	if (areas.size === 0) areas.add("other");
	return [...areas];
}

/**
 * Map a list of touched paths to the deduplicated union of their areas
 * (multi-label across the whole change set). Order is stable: areas appear in
 * the order they are first encountered.
 */
export function pathsToAreas(paths: readonly string[]): AreaTag[] {
	const areas = new Set<AreaTag>();
	for (const path of paths) {
		for (const area of pathToAreas(path)) areas.add(area);
	}
	if (areas.size === 0) areas.add("other");
	return [...areas];
}
