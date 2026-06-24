import { describe, expect, it } from "bun:test";
import {
	buildEnrichmentPrompt,
	enrichGuide,
	type GuideEnrichmentSession,
	mergeEnrichment,
	parseEnrichmentReply,
} from "./enrich-guide.ts";
import type { PrDiffInput, PrReviewGuide } from "./guide-types.ts";

function fixtureGuide(): PrReviewGuide {
	return {
		prNumber: 42,
		headSha: "abcdef1",
		areaTags: ["auth", "backend"],
		grounded: true,
		sections: [
			{
				id: "at-a-glance",
				title: "At a glance",
				items: [{ text: "PR #42 into main" }],
			},
			{
				id: "read-first",
				title: "Read first",
				items: [
					{
						text: "1. packages/auth/src/session.ts — entry/config",
						anchor: { file: "packages/auth/src/session.ts" },
					},
					{
						text: "2. packages/db/drizzle/0007.sql — schema/migration",
						anchor: { file: "packages/db/drizzle/0007.sql" },
					},
				],
			},
			{
				id: "risk-flags",
				title: "Risk flags",
				items: [
					{
						text: "Migration touched",
						severity: "danger",
						anchor: { file: "packages/db/drizzle/0007.sql" },
					},
				],
			},
		],
	};
}

function fixtureDiff(): PrDiffInput {
	return {
		prNumber: 42,
		headSha: "abcdef1",
		baseBranch: "main",
		body: "Add token refresh",
		files: [
			{
				filename: "packages/auth/src/session.ts",
				status: "modified",
				patch: "+x",
				additions: 10,
				deletions: 2,
			},
		],
	};
}

/** A session that returns a fixed reply (or is unavailable). */
function stubSession(opts: {
	available: boolean;
	reply?: string | null;
	onComplete?: () => void;
}): GuideEnrichmentSession {
	return {
		isAvailable: () => opts.available,
		complete: async () => {
			opts.onComplete?.();
			return opts.reply ?? null;
		},
	};
}

describe("parseEnrichmentReply", () => {
	it("parses a bare JSON object", () => {
		const out = parseEnrichmentReply(
			'{"overview":"Refactors auth.","notes":{"read-first#0":"core change"}}',
		);
		expect(out?.overview).toBe("Refactors auth.");
		expect(out?.notes?.["read-first#0"]).toBe("core change");
	});

	it("extracts JSON wrapped in prose / code fences", () => {
		const out = parseEnrichmentReply(
			'Sure! Here is the result:\n```json\n{"overview":"Hello"}\n```\nDone.',
		);
		expect(out?.overview).toBe("Hello");
	});

	it("returns null on malformed / empty / no-json input", () => {
		expect(parseEnrichmentReply("not json at all")).toBeNull();
		expect(parseEnrichmentReply("{ broken")).toBeNull();
		expect(parseEnrichmentReply("{}")).toBeNull();
	});
});

describe("buildEnrichmentPrompt", () => {
	it("lists only anchored items with their stable ids", () => {
		const prompt = buildEnrichmentPrompt({
			skeleton: fixtureGuide(),
			diff: fixtureDiff(),
		});
		// Anchored read-first items are offered with `${sectionId}#${index}` ids.
		expect(prompt).toContain("read-first#0:");
		expect(prompt).toContain("risk-flags#0:");
		// The non-anchored at-a-glance item is NOT offered for annotation.
		expect(prompt).not.toContain("at-a-glance#0:");
		expect(prompt).toContain("PR #42");
	});
});

describe("mergeEnrichment — anchor preservation", () => {
	it("appends overview + notes WITHOUT mutating anchors", () => {
		const skeleton = fixtureGuide();
		const merged = mergeEnrichment({
			skeleton,
			payload: {
				overview: "Token refresh with a new migration.",
				notes: {
					"read-first#0": "rotates the session token",
					"risk-flags#0": "irreversible drop",
				},
			},
		});

		// Overview prepended to at-a-glance as an anchor-less item.
		const glance = merged.sections.find((s) => s.id === "at-a-glance");
		expect(glance?.items[0]?.text).toContain("Overview:");
		expect(glance?.items[0]?.anchor).toBeUndefined();

		// Notes appended to the EXACT anchored items; anchors unchanged.
		const readFirst = merged.sections.find((s) => s.id === "read-first");
		expect(readFirst?.items[0]?.text).toContain("rotates the session token");
		expect(readFirst?.items[0]?.anchor).toEqual({
			file: "packages/auth/src/session.ts",
		});
		// The second read-first item got no note → text untouched.
		expect(readFirst?.items[1]?.text).toBe(
			"2. packages/db/drizzle/0007.sql — schema/migration",
		);

		// Risk severity + anchor preserved through the merge.
		const risk = merged.sections.find((s) => s.id === "risk-flags");
		expect(risk?.items[0]?.severity).toBe("danger");
		expect(risk?.items[0]?.anchor).toEqual({
			file: "packages/db/drizzle/0007.sql",
		});
		expect(merged.enriched).toBe(true);
	});

	it("ignores notes keyed to non-existent / non-anchored items", () => {
		const merged = mergeEnrichment({
			skeleton: fixtureGuide(),
			payload: {
				notes: {
					"read-first#99": "nonexistent index",
					"at-a-glance#0": "non-anchored item",
				},
			},
		});
		// at-a-glance item is non-anchored → note must NOT attach.
		const glance = merged.sections.find((s) => s.id === "at-a-glance");
		expect(glance?.items[0]?.text).toBe("PR #42 into main");
	});

	it("redacts secrets in model-contributed prose", () => {
		const merged = mergeEnrichment({
			skeleton: fixtureGuide(),
			payload: {
				overview: "uses ghp_0123456789012345678901234567890123 token",
				notes: { "read-first#0": "see AKIA0123456789ABCDEF" },
			},
		});
		const glance = merged.sections.find((s) => s.id === "at-a-glance");
		expect(glance?.items[0]?.text).not.toContain("ghp_0123456789");
		expect(glance?.items[0]?.text).toContain("REDACTED");
		const readFirst = merged.sections.find((s) => s.id === "read-first");
		expect(readFirst?.items[0]?.text).not.toContain("AKIA0123456789ABCDEF");
	});
});

describe("enrichGuide — best-effort entry point", () => {
	it("returns the skeleton UNCHANGED when no session is available", async () => {
		const skeleton = fixtureGuide();
		let completeCalled = false;
		const out = await enrichGuide({
			skeleton,
			diff: fixtureDiff(),
			session: stubSession({
				available: false,
				onComplete: () => {
					completeCalled = true;
				},
			}),
		});
		expect(out).toEqual(skeleton);
		expect(out.enriched).toBeUndefined();
		// Never even prompts the model when unavailable.
		expect(completeCalled).toBe(false);
	});

	it("returns the skeleton UNCHANGED when the session returns null", async () => {
		const skeleton = fixtureGuide();
		const out = await enrichGuide({
			skeleton,
			diff: fixtureDiff(),
			session: stubSession({ available: true, reply: null }),
		});
		expect(out).toEqual(skeleton);
	});

	it("returns the skeleton UNCHANGED (no throw) when the session throws", async () => {
		const skeleton = fixtureGuide();
		const throwing: GuideEnrichmentSession = {
			isAvailable: () => true,
			complete: async () => {
				throw new Error("session blew up");
			},
		};
		const out = await enrichGuide({
			skeleton,
			diff: fixtureDiff(),
			session: throwing,
		});
		expect(out).toEqual(skeleton);
	});

	it("merges a valid reply while preserving anchors", async () => {
		const out = await enrichGuide({
			skeleton: fixtureGuide(),
			diff: fixtureDiff(),
			session: stubSession({
				available: true,
				reply:
					'{"overview":"Adds token refresh.","notes":{"read-first#0":"entry point"}}',
			}),
		});
		expect(out.enriched).toBe(true);
		const glance = out.sections.find((s) => s.id === "at-a-glance");
		expect(glance?.items[0]?.text).toContain("Adds token refresh.");
		const readFirst = out.sections.find((s) => s.id === "read-first");
		expect(readFirst?.items[0]?.anchor).toEqual({
			file: "packages/auth/src/session.ts",
		});
	});
});
