import { describe, expect, it } from "bun:test";
import { pathsToAreas, pathToAreas } from "./path-to-area";

describe("pathToAreas", () => {
	it("maps app paths to their primary area", () => {
		expect(pathToAreas("apps/web/src/page.tsx")).toEqual(["frontend"]);
		expect(pathToAreas("apps/desktop/src/main/index.ts")).toEqual(["desktop"]);
		expect(pathToAreas("apps/api/src/server.ts")).toEqual(["backend"]);
	});

	it("maps package paths from the AGENTS.md layout", () => {
		expect(pathToAreas("packages/host-service/src/serve.ts")).toEqual([
			"backend",
		]);
		expect(pathToAreas("packages/db/src/schema/users.ts")).toEqual([
			"schema",
			"backend",
		]);
		expect(pathToAreas("packages/ui/src/components/button.tsx")).toEqual([
			"design-system",
			"frontend",
		]);
		expect(pathToAreas("packages/trpc/src/router.ts")).toEqual([
			"trpc",
			"backend",
		]);
		expect(pathToAreas("packages/mcp/src/server.ts")).toEqual([
			"mcp",
			"backend",
		]);
	});

	it("tags the new memory package", () => {
		expect(pathToAreas("packages/memory/src/index.ts")).toEqual([
			"memory",
			"backend",
		]);
	});

	it("is MULTI-LABEL: a test file under a package gets package + tests areas", () => {
		const areas = pathToAreas(
			"packages/host-service/src/trpc/router/memory/memory.test.ts",
		);
		expect(areas).toContain("backend");
		expect(areas).toContain("tests");
	});

	it("is MULTI-LABEL: an integration test dir gets backend + tests", () => {
		const areas = pathToAreas(
			"packages/host-service/test/integration/foo.integration.test.ts",
		);
		expect(areas).toContain("backend");
		expect(areas).toContain("tests");
	});

	it("is MULTI-LABEL: a drizzle migration is schema even outside packages/db", () => {
		const areas = pathToAreas("packages/host-service/drizzle/0007_memory.sql");
		expect(areas).toContain("backend");
		expect(areas).toContain("schema");
	});

	it("tags config files regardless of package", () => {
		expect(pathToAreas("packages/memory/package.json")).toContain("config");
		expect(pathToAreas("biome.jsonc")).toContain("config");
		expect(pathToAreas("packages/host-service/drizzle.config.ts")).toContain(
			"config",
		);
	});

	it("normalizes backslashes and leading ./ and /", () => {
		expect(pathToAreas("./apps/web/page.tsx")).toEqual(["frontend"]);
		expect(pathToAreas("apps\\web\\page.tsx")).toEqual(["frontend"]);
		expect(pathToAreas("/apps/web/page.tsx")).toEqual(["frontend"]);
	});

	it("matches the bare package root (no trailing path)", () => {
		expect(pathToAreas("apps/web")).toEqual(["frontend"]);
	});

	it("does NOT false-match a sibling with a shared prefix", () => {
		// "apps/webby" must not match the "apps/web" rule.
		expect(pathToAreas("apps/webby/foo.ts")).toEqual(["other"]);
	});

	it("falls back to 'other' for unrecognized paths (negative case)", () => {
		expect(pathToAreas("some/random/file.ts")).toEqual(["other"]);
		expect(pathToAreas("README.md")).toEqual(["other"]);
	});
});

describe("pathsToAreas", () => {
	it("unions areas across a change set, deduplicated and order-stable", () => {
		const areas = pathsToAreas([
			"apps/web/src/page.tsx",
			"packages/db/src/schema/users.ts",
			"packages/db/src/schema/users.ts",
		]);
		expect(areas).toEqual(["frontend", "schema", "backend"]);
	});

	it("returns ['other'] for an empty change set", () => {
		expect(pathsToAreas([])).toEqual(["other"]);
	});

	it("combines package + secondary tags across files", () => {
		const areas = pathsToAreas([
			"packages/host-service/src/db/schema.ts",
			"packages/host-service/src/db/schema.test.ts",
			"packages/host-service/drizzle/0007_memory.sql",
		]);
		expect(areas).toContain("backend");
		expect(areas).toContain("tests");
		expect(areas).toContain("schema");
	});
});
