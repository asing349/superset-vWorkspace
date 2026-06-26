import { describe, expect, it } from "bun:test";
import { decryptToken, encryptToken } from "./crypto";

describe("linear-auth crypto", () => {
	it("round-trips a token through encrypt/decrypt", () => {
		const token = "lin_oauth_abc123.secret-value";
		const encrypted = encryptToken(token);
		expect(decryptToken(encrypted)).toBe(token);
	});

	it("never emits the plaintext token in the ciphertext", () => {
		const token = "super-secret-access-token";
		const encrypted = encryptToken(token);
		expect(encrypted).not.toContain(token);
		// base64-encoded ciphertext, not the raw value.
		expect(encrypted).not.toBe(token);
	});

	it("produces a fresh ciphertext each call (random salt + iv)", () => {
		const token = "same-token";
		expect(encryptToken(token)).not.toBe(encryptToken(token));
	});

	it("rejects tampered ciphertext (GCM auth tag)", () => {
		const encrypted = encryptToken("tamper-me");
		const tampered = `${encrypted.slice(0, -4)}AAAA`;
		expect(() => decryptToken(tampered)).toThrow();
	});
});
