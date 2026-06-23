import { describe, expect, it } from "bun:test";
import { contentHash, isFingerprintStale } from "./fingerprint";

describe("contentHash", () => {
	it("is deterministic for the same input", () => {
		expect(contentHash("hello world")).toBe(contentHash("hello world"));
	});

	it("differs for different input", () => {
		expect(contentHash("a")).not.toBe(contentHash("b"));
		expect(contentHash("hello")).not.toBe(contentHash("hellp"));
	});

	it("returns a 16-char lowercase hex string", () => {
		const h = contentHash("anything at all");
		expect(h).toMatch(/^[0-9a-f]{16}$/);
	});

	it("handles empty input", () => {
		expect(contentHash("")).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("isFingerprintStale", () => {
	it("is stale when there is no previous hash", () => {
		expect(isFingerprintStale({ previousHash: null, currentHash: "abc" })).toBe(
			true,
		);
		expect(
			isFingerprintStale({ previousHash: undefined, currentHash: "abc" }),
		).toBe(true);
	});

	it("is stale when hashes differ", () => {
		expect(
			isFingerprintStale({ previousHash: "abc", currentHash: "def" }),
		).toBe(true);
	});

	it("is fresh when hashes match", () => {
		expect(
			isFingerprintStale({ previousHash: "abc", currentHash: "abc" }),
		).toBe(false);
	});
});
