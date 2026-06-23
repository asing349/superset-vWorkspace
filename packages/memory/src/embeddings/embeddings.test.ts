import { describe, expect, it } from "bun:test";
import {
	cosineSimilarity,
	dot,
	isLoopbackUrl,
	norm,
	topKBySimilarity,
} from "./embeddings";

describe("isLoopbackUrl", () => {
	it("accepts loopback hosts", () => {
		expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
		expect(isLoopbackUrl("http://localhost:11434/api/tags")).toBe(true);
		expect(isLoopbackUrl("http://[::1]:11434")).toBe(true);
		expect(isLoopbackUrl("https://localhost")).toBe(true);
		expect(isLoopbackUrl("http://foo.localhost:1234")).toBe(true);
	});

	it("REJECTS any non-local host (no cloud egress)", () => {
		expect(isLoopbackUrl("http://api.openai.com/v1/embeddings")).toBe(false);
		expect(isLoopbackUrl("https://example.com")).toBe(false);
		expect(isLoopbackUrl("http://10.0.0.5:11434")).toBe(false);
		expect(isLoopbackUrl("http://192.168.1.10:11434")).toBe(false);
		expect(isLoopbackUrl("http://evil.localhost.attacker.com")).toBe(false);
	});

	it("rejects non-http(s) and garbage", () => {
		expect(isLoopbackUrl("ftp://127.0.0.1")).toBe(false);
		expect(isLoopbackUrl("not a url")).toBe(false);
		expect(isLoopbackUrl("")).toBe(false);
	});
});

describe("cosine similarity math", () => {
	it("dot + norm basics", () => {
		expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
		expect(dot([1, 2], [1, 2, 3])).toBe(0); // length mismatch
		expect(norm([3, 4])).toBe(5);
	});

	it("cosine of identical direction is 1", () => {
		expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
	});

	it("cosine of orthogonal vectors is 0", () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
	});

	it("cosine of opposite vectors is -1", () => {
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
	});

	it("returns 0 on empty / zero / mismatched vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
	});
});

describe("topKBySimilarity", () => {
	const items = [
		{ vector: [1, 0, 0], meta: "x-axis" },
		{ vector: [0, 1, 0], meta: "y-axis" },
		{ vector: [0.9, 0.1, 0], meta: "near-x" },
	];

	it("ranks by similarity to the query, descending", () => {
		const ranked = topKBySimilarity({ query: [1, 0, 0], items });
		expect(ranked[0]?.meta).toBe("x-axis");
		expect(ranked[1]?.meta).toBe("near-x");
		expect(ranked[2]?.meta).toBe("y-axis");
	});

	it("respects topK", () => {
		const ranked = topKBySimilarity({ query: [1, 0, 0], items, topK: 1 });
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.meta).toBe("x-axis");
	});

	it("drops matches below minScore", () => {
		const ranked = topKBySimilarity({
			query: [1, 0, 0],
			items,
			minScore: 0.5,
		});
		expect(ranked.map((r) => r.meta)).toEqual(["x-axis", "near-x"]);
	});

	it("handles an empty store", () => {
		expect(topKBySimilarity({ query: [1, 0, 0], items: [] })).toEqual([]);
	});
});
