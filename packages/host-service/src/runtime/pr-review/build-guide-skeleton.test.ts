import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	AreaTag,
	PlaybookStatus,
	PracticeVersion,
	ProjectIndexEntry,
	RetrievalBundle,
} from "@superset/memory";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import {
	memoryPlaybooks,
	memoryPracticeVersions,
	memoryProjectIndex,
	projects,
} from "../../db/schema";
import { MemoryRetrieveService } from "../memory/retrieve-service.ts";
import {
	buildGuideSkeleton,
	type GuideGroundingServices,
	type GuidePlaybook,
} from "./build-guide-skeleton.ts";
import type {
	GuideSection,
	GuideSectionId,
	PrDiffInput,
} from "./guide-types.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/** A representative multi-area PR diff fixture (no real PR fetch). */
function fixtureDiff(): PrDiffInput {
	return {
		prNumber: 42,
		headSha: "abcdef1234567890",
		baseBranch: "main",
		body: "Add auth token refresh and a new migration\n\nDetails follow.",
		files: [
			{
				filename: "packages/db/drizzle/0007_add_tokens.sql",
				status: "added",
				patch: "+CREATE TABLE tokens (id text);",
				additions: 12,
				deletions: 0,
			},
			{
				filename: "packages/auth/src/session/session.ts",
				status: "modified",
				patch: "-export function oldHelper() {}\n+function newHelper() {}",
				additions: 30,
				deletions: 8,
			},
			{
				filename: "packages/host-service/src/runtime/big.ts",
				status: "modified",
				patch: null,
				additions: 500,
				deletions: 20,
			},
			{
				filename: "bun.lock",
				status: "modified",
				patch: "+  some-dep@1.2.3",
				additions: 4,
				deletions: 1,
			},
			{
				filename: "packages/host-service/src/runtime/big.test.ts",
				status: "added",
				patch: "+it('works', () => {})",
				additions: 40,
				deletions: 0,
			},
		],
	};
}

function sectionById(
	guide: { sections: GuideSection[] },
	id: GuideSectionId,
): GuideSection | undefined {
	return guide.sections.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// In-memory stub grounding services (decoupled-port testing)
// ---------------------------------------------------------------------------

function stubServices(overrides: {
	indexed: boolean;
	entries?: ProjectIndexEntry[];
	playbooks?: GuidePlaybook[];
	practice?: PracticeVersion | null;
	globalPractice?: PracticeVersion | null;
	bundle?: RetrievalBundle;
}): GuideGroundingServices {
	const entries = overrides.entries ?? [];
	const emptyBundle: RetrievalBundle = {
		queryAreas: [],
		practices: [],
		playbooks: [],
		indexSlices: [],
		semanticSlices: [],
		estimatedTokens: 0,
		estimatedTokensBeforeCap: 0,
		trimmed: false,
	};
	return {
		retrieve: {
			retrieve: () => overrides.bundle ?? emptyBundle,
		},
		index: {
			indexStatus: () => ({
				indexed: overrides.indexed,
				entryCount: entries.length,
			}),
			listEntries: () => entries,
		},
		practice: {
			getPractice: ({ scope }) => ({
				latest:
					scope === "project"
						? (overrides.practice ?? null)
						: (overrides.globalPractice ?? null),
			}),
		},
		playbooks: {
			listPlaybooks: () => overrides.playbooks ?? [],
		},
	};
}

function makePractice(content: string, version: number): PracticeVersion {
	return {
		id: `pv-${version}`,
		scope: "project",
		projectId: "proj-1",
		version,
		content,
		provenance: null,
		createdAt: 1,
	};
}

function makePlaybook(over: Partial<GuidePlaybook>): GuidePlaybook {
	return {
		id: over.id ?? "pb-1",
		intent: over.intent ?? "Refactor auth session handling",
		areaTags: over.areaTags ?? (["auth", "backend"] as AreaTag[]),
		status: over.status ?? ("confirmed" as PlaybookStatus),
		confidence: over.confidence ?? 90,
		provenance: over.provenance ?? { prNumber: 7, url: "https://pr/7" },
	};
}

function makeIndexEntry(
	path: string,
	summary: string | null,
): ProjectIndexEntry {
	return {
		id: `idx-${path}`,
		projectId: "proj-1",
		path,
		kind: "file",
		areaTags: ["backend"],
		summary,
		fingerprintId: null,
		updatedAt: 1,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGuideSkeleton — deterministic sections", () => {
	it("always emits diff-only sections with anchors on code claims", async () => {
		const guide = await buildGuideSkeleton({
			diff: fixtureDiff(),
			projectId: null,
			services: stubServices({ indexed: false }),
		});

		expect(guide.prNumber).toBe(42);
		expect(guide.headSha).toBe("abcdef1234567890");
		expect(guide.grounded).toBe(false);

		// Diff-only sections are present.
		for (const id of [
			"at-a-glance",
			"what-changed",
			"read-first",
			"risk-flags",
			"checks-and-threads",
		] as const) {
			expect(sectionById(guide, id)).toBeDefined();
		}
		// Grounding sections are absent when degraded.
		expect(sectionById(guide, "project-conventions")).toBeUndefined();
		expect(sectionById(guide, "prior-playbooks")).toBeUndefined();
		expect(sectionById(guide, "where-x-lives")).toBeUndefined();

		// what-changed: every per-file claim carries a file anchor.
		const whatChanged = sectionById(guide, "what-changed");
		const fileItems = whatChanged?.items.filter((i) => i.anchor) ?? [];
		expect(fileItems.length).toBeGreaterThan(0);
		for (const item of fileItems) {
			expect(item.anchor?.file).toBeTruthy();
		}
	});

	it("orders read-first: schema → entry/public-API → high-churn → tests last", async () => {
		const guide = await buildGuideSkeleton({
			diff: fixtureDiff(),
			projectId: null,
			services: stubServices({ indexed: false }),
		});
		const readFirst = sectionById(guide, "read-first");
		const orderedFiles = (readFirst?.items ?? []).map((i) => i.anchor?.file);

		// Migration is first; the test file is last among the listed files.
		expect(orderedFiles[0]).toBe("packages/db/drizzle/0007_add_tokens.sql");
		const testIdx = orderedFiles.indexOf(
			"packages/host-service/src/runtime/big.test.ts",
		);
		const bigIdx = orderedFiles.indexOf(
			"packages/host-service/src/runtime/big.ts",
		);
		expect(testIdx).toBeGreaterThan(bigIdx);
	});

	it("raises migration, auth, deleted-export, large-churn, and lockfile risks", async () => {
		const guide = await buildGuideSkeleton({
			diff: fixtureDiff(),
			projectId: null,
			services: stubServices({ indexed: false }),
		});
		const risks = sectionById(guide, "risk-flags");
		const text = (risks?.items ?? []).map((i) => i.text).join("\n");

		expect(text).toContain("Migration touched");
		expect(text).toContain("Auth-sensitive");
		expect(text).toContain("Removes an export");
		expect(text).toContain("Large churn");
		expect(text).toContain("Lockfile changed");

		// Migration + auth risks carry danger severity and an anchor.
		const danger = (risks?.items ?? []).filter((i) => i.severity === "danger");
		expect(danger.length).toBeGreaterThanOrEqual(2);
		for (const item of danger) expect(item.anchor?.file).toBeTruthy();
	});

	it("flags no-test when source changes without a test", async () => {
		const diff: PrDiffInput = {
			prNumber: 1,
			headSha: "deadbeef",
			baseBranch: "main",
			body: null,
			files: [
				{
					filename: "packages/host-service/src/x.ts",
					status: "modified",
					patch: "+const y = 1;",
					additions: 3,
					deletions: 0,
				},
			],
		};
		const guide = await buildGuideSkeleton({
			diff,
			projectId: null,
			services: stubServices({ indexed: false }),
		});
		const risks = sectionById(guide, "risk-flags");
		const text = (risks?.items ?? []).map((i) => i.text).join("\n");
		expect(text).toContain("No test files changed");
	});
});

describe("buildGuideSkeleton — memory-grounded path (stub ports)", () => {
	it("adds conventions, playbooks, and where-x-lives when indexed", async () => {
		const guide = await buildGuideSkeleton({
			diff: fixtureDiff(),
			projectId: "proj-1",
			services: stubServices({
				indexed: true,
				entries: [
					makeIndexEntry(
						"packages/auth/src/session/session.ts",
						"exports newHelper",
					),
					makeIndexEntry("packages/host-service/src/runtime/big.ts", null),
				],
				playbooks: [
					makePlaybook({ id: "pb-auth" }),
					makePlaybook({
						id: "pb-frontend",
						intent: "irrelevant frontend",
						areaTags: ["frontend"] as AreaTag[],
					}),
				],
				practice: makePractice("Use object params for 2+ args.", 3),
				globalPractice: makePractice("Bun only; no npm.", 1),
				bundle: {
					queryAreas: ["auth"],
					practices: [],
					playbooks: [
						{
							id: "pb-auth",
							intent: "Refactor auth session handling",
							areaTags: ["auth"],
							commands: ["bun test packages/host-service"],
							gotcha: null,
							diffShape: null,
							validation: null,
							status: "confirmed",
							confidence: 90,
							score: 1,
						},
					],
					indexSlices: [],
					semanticSlices: [],
					estimatedTokens: 10,
					estimatedTokensBeforeCap: 10,
					trimmed: false,
				},
			}),
		});

		expect(guide.grounded).toBe(true);

		const conventions = sectionById(guide, "project-conventions");
		expect(conventions?.items.map((i) => i.text).join("\n")).toContain(
			"Use object params",
		);

		const playbooks = sectionById(guide, "prior-playbooks");
		const pbText = playbooks?.items.map((i) => i.text).join("\n") ?? "";
		// Area-filtered: the auth playbook is kept, the frontend one dropped.
		expect(pbText).toContain("Refactor auth session handling");
		expect(pbText).not.toContain("irrelevant frontend");
		// Provenance URL surfaces as href.
		expect(playbooks?.items[0]?.href).toBe("https://pr/7");

		const where = sectionById(guide, "where-x-lives");
		const whereItems = where?.items ?? [];
		expect(whereItems.length).toBeGreaterThan(0);
		for (const item of whereItems) expect(item.anchor?.file).toBeTruthy();

		// Suggested checks come from the retrieval bundle's playbook commands.
		const checks = sectionById(guide, "checks-and-threads");
		expect(checks?.items.map((i) => i.text).join("\n")).toContain(
			"bun test packages/host-service",
		);
	});

	it("degrades to diff-only when the project index is empty", async () => {
		const guide = await buildGuideSkeleton({
			diff: fixtureDiff(),
			projectId: "proj-1",
			services: stubServices({ indexed: false, entries: [] }),
		});
		expect(guide.grounded).toBe(false);
		expect(sectionById(guide, "prior-playbooks")).toBeUndefined();
	});
});

describe("buildGuideSkeleton — integration with real memory services", () => {
	let db: HostDb;
	let homeDir: string;
	let prevHome: string | undefined;
	const projectId = "proj-guide";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
		homeDir = mkdtempSync(join(tmpdir(), "guide-home-"));
		prevHome = process.env.SUPERSET_HOME_DIR;
		process.env.SUPERSET_HOME_DIR = homeDir;
	});

	afterEach(() => {
		if (prevHome === undefined) delete process.env.SUPERSET_HOME_DIR;
		else process.env.SUPERSET_HOME_DIR = prevHome;
		rmSync(homeDir, { recursive: true, force: true });
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("grounds via real MemoryRetrieveService + db-backed practice/playbooks/index", async () => {
		// Seed a confirmed auth playbook, a project practice, and one index entry.
		db.insert(memoryPlaybooks)
			.values({
				id: "pb-real",
				projectId,
				intent: "Harden auth session refresh",
				touchedPathsJson: JSON.stringify(["packages/auth/src/session.ts"]),
				areaTagsJson: JSON.stringify(["auth", "backend"]),
				commandsJson: JSON.stringify(["bun test packages/host-service"]),
				gotcha: null,
				diffShape: null,
				validation: "green",
				status: "confirmed",
				confidence: 95,
				provenanceJson: JSON.stringify({
					prNumber: 11,
					url: "https://pr/11",
					taskId: null,
				}),
			})
			.run();
		db.insert(memoryPracticeVersions)
			.values({
				id: "pv-real",
				scope: "project",
				projectId,
				version: 1,
				content: "Always run host-service tests scoped, never whole-tree.",
				provenance: null,
			})
			.run();
		db.insert(memoryProjectIndex)
			.values({
				id: "idx-real",
				projectId,
				path: "packages/auth/src/session/session.ts",
				kind: "file",
				areaTagsJson: JSON.stringify(["auth", "backend"]),
				summary: "exports refreshSession",
				fingerprintId: null,
			})
			.run();

		const retrieve = new MemoryRetrieveService({ db });
		const services: GuideGroundingServices = {
			retrieve: {
				retrieve: (input) => retrieve.retrieve(input),
			},
			index: {
				indexStatus: (pid) => {
					const rows = db
						.select()
						.from(memoryProjectIndex)
						.all()
						.filter((r) => r.projectId === pid);
					return { indexed: rows.length > 0, entryCount: rows.length };
				},
				listEntries: (pid) =>
					db
						.select()
						.from(memoryProjectIndex)
						.all()
						.filter((r) => r.projectId === pid)
						.map((r) => ({
							id: r.id,
							projectId: r.projectId,
							path: r.path,
							kind: r.kind,
							areaTags: JSON.parse(r.areaTagsJson) as AreaTag[],
							summary: r.summary,
							fingerprintId: r.fingerprintId,
							updatedAt: r.updatedAt,
						})),
			},
			practice: {
				getPractice: ({ scope, projectId: pid }) => ({
					latest: retrieve.readPracticeVersion({ scope, projectId: pid }),
				}),
			},
			playbooks: {
				listPlaybooks: ({ projectId: pid }) =>
					db
						.select()
						.from(memoryPlaybooks)
						.all()
						.filter((r) => r.projectId === pid)
						.map((r) => ({
							id: r.id,
							intent: r.intent,
							areaTags: JSON.parse(r.areaTagsJson) as AreaTag[],
							status: r.status as PlaybookStatus,
							confidence: r.confidence,
							provenance: JSON.parse(r.provenanceJson) as {
								prNumber: number | null;
								url: string | null;
							},
						})),
			},
		};

		const diff: PrDiffInput = {
			prNumber: 99,
			headSha: "cafebabe00000000",
			baseBranch: "main",
			body: "auth session refresh",
			files: [
				{
					filename: "packages/auth/src/session/session.ts",
					status: "modified",
					patch: "+const x = 1;",
					additions: 10,
					deletions: 2,
				},
			],
		};

		const guide = await buildGuideSkeleton({ diff, projectId, services });

		expect(guide.grounded).toBe(true);
		expect(
			sectionById(guide, "project-conventions")
				?.items.map((i) => i.text)
				.join("\n"),
		).toContain("host-service tests scoped");
		expect(
			sectionById(guide, "prior-playbooks")
				?.items.map((i) => i.text)
				.join("\n"),
		).toContain("Harden auth session refresh");
		expect(
			sectionById(guide, "where-x-lives")
				?.items.map((i) => i.text)
				.join("\n"),
		).toContain("exports refreshSession");
	});
});
