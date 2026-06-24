import { describe, expect, it } from "bun:test";
import type { RetrievalBundle } from "@superset/memory";
import type { GuideGroundingServices } from "./build-guide-skeleton.ts";
import type { GuideEnrichmentSession } from "./enrich-guide.ts";
import {
	type GuideCacheSink,
	type GuideDiffSource,
	generateGuideCore,
	normalizeFileStatus,
	toGuideDiffInput,
} from "./generate-guide.ts";
import type { PrReviewGuide } from "./guide-types.ts";

// ---------------------------------------------------------------------------
// Status reconciliation
// ---------------------------------------------------------------------------

describe("normalizeFileStatus", () => {
	it("maps GitHub 'removed' onto 'deleted'", () => {
		expect(normalizeFileStatus("removed")).toBe("deleted");
	});
	it("passes through valid FileStatus values (case-insensitive)", () => {
		expect(normalizeFileStatus("added")).toBe("added");
		expect(normalizeFileStatus("MODIFIED")).toBe("modified");
		expect(normalizeFileStatus("renamed")).toBe("renamed");
	});
	it("collapses unknown statuses to 'changed'", () => {
		expect(normalizeFileStatus("unchanged")).toBe("changed");
		expect(normalizeFileStatus("weird")).toBe("changed");
	});
});

describe("toGuideDiffInput", () => {
	it("normalizes every file status and preserves previousFilename", () => {
		const input = toGuideDiffInput({
			prNumber: 5,
			headSha: "sha5",
			baseBranch: "main",
			body: "b",
			files: [
				{
					filename: "a.ts",
					status: "removed",
					patch: null,
					additions: 0,
					deletions: 4,
					previousFilename: "old.ts",
				},
				{
					filename: "b.ts",
					status: "added",
					patch: "+x",
					additions: 2,
					deletions: 0,
				},
			],
		});
		expect(input.files[0]?.status).toBe("deleted");
		expect(input.files[0]?.previousFilename).toBe("old.ts");
		expect(input.files[1]?.status).toBe("added");
		expect(input.files[1]?.previousFilename).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Pipeline core (injected ports)
// ---------------------------------------------------------------------------

const EMPTY_BUNDLE: RetrievalBundle = {
	queryAreas: [],
	practices: [],
	playbooks: [],
	indexSlices: [],
	semanticSlices: [],
	estimatedTokens: 0,
	estimatedTokensBeforeCap: 0,
	trimmed: false,
};

/** A grounding bundle with no index → buildGuideSkeleton degrades to diff-only. */
function ungroundedServices(): GuideGroundingServices {
	return {
		retrieve: { retrieve: () => EMPTY_BUNDLE },
		index: {
			indexStatus: () => ({ indexed: false, entryCount: 0 }),
			listEntries: () => [],
		},
		practice: { getPractice: () => ({ latest: null }) },
		playbooks: { listPlaybooks: () => [] },
	};
}

function diffSourceWith(headSha: string): GuideDiffSource {
	return {
		fetch: async ({ prNumber }) => ({
			prNumber,
			headSha,
			baseBranch: "main",
			body: "Adds a thing",
			files: [
				{
					filename: "packages/host-service/src/x.ts",
					status: "modified",
					patch: "+const y = 1;",
					additions: 3,
					deletions: 0,
				},
			],
		}),
	};
}

describe("generateGuideCore", () => {
	it("produces a deterministic guide when no session is supplied", async () => {
		const guide = await generateGuideCore({
			projectId: "proj-1",
			prNumber: 7,
			diffSource: diffSourceWith("sha-7"),
			grounding: ungroundedServices(),
			session: null,
		});
		expect(guide.prNumber).toBe(7);
		expect(guide.headSha).toBe("sha-7");
		expect(guide.enriched).toBeUndefined();
		// Diff-only baseline sections present.
		expect(guide.sections.some((s) => s.id === "at-a-glance")).toBe(true);
		expect(guide.sections.some((s) => s.id === "risk-flags")).toBe(true);
	});

	it("enriches via an available session and persists with the head-SHA key", async () => {
		let persisted: {
			projectId: string;
			prNumber: number;
			headSha: string;
			guide: PrReviewGuide;
		} | null = null;
		const cache: GuideCacheSink = {
			put: (args) => {
				persisted = args;
			},
		};
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => '{"overview":"A concise overview."}',
		};

		const guide = await generateGuideCore({
			projectId: "proj-1",
			prNumber: 9,
			diffSource: diffSourceWith("sha-9"),
			grounding: ungroundedServices(),
			session,
			cache,
		});

		expect(guide.enriched).toBe(true);
		const glance = guide.sections.find((s) => s.id === "at-a-glance");
		expect(glance?.items[0]?.text).toContain("A concise overview.");

		// Persisted under (projectId, prNumber, headSha).
		expect(persisted).not.toBeNull();
		const saved = persisted as unknown as {
			projectId: string;
			prNumber: number;
			headSha: string;
		};
		expect(saved.projectId).toBe("proj-1");
		expect(saved.prNumber).toBe(9);
		expect(saved.headSha).toBe("sha-9");
	});

	it("degrades to the deterministic guide when the session yields nothing", async () => {
		const session: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => null,
		};
		const guide = await generateGuideCore({
			projectId: "proj-1",
			prNumber: 11,
			diffSource: diffSourceWith("sha-11"),
			grounding: ungroundedServices(),
			session,
		});
		expect(guide.enriched).toBeUndefined();
	});

	it("does NOT persist when the diff couldn't resolve (empty head SHA)", async () => {
		let putCalls = 0;
		const cache: GuideCacheSink = {
			put: () => {
				putCalls += 1;
			},
		};
		const emptyDiffSource: GuideDiffSource = {
			fetch: async ({ prNumber }) => ({
				prNumber,
				headSha: "",
				baseBranch: "",
				body: null,
				files: [],
			}),
		};
		await generateGuideCore({
			projectId: "proj-1",
			prNumber: 13,
			diffSource: emptyDiffSource,
			grounding: ungroundedServices(),
			session: null,
			cache,
		});
		expect(putCalls).toBe(0);
	});
});
