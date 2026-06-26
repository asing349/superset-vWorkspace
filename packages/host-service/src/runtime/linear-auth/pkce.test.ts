import { describe, expect, it } from "bun:test";
import {
	createCodeVerifier,
	deriveCodeChallenge,
	generateOAuthState,
	generatePkcePair,
} from "./pkce";

describe("pkce", () => {
	it("derives the S256 code_challenge from the RFC 7636 Appendix B vector", () => {
		// The canonical RFC 7636 example: verifier → challenge.
		const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
		const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
		expect(deriveCodeChallenge(verifier)).toBe(expected);
	});

	it("produces a base64url challenge (no +, /, or = padding)", () => {
		const { challenge } = generatePkcePair();
		expect(challenge).not.toMatch(/[+/=]/);
	});

	it("derives a stable, S256-tagged pair whose challenge matches the verifier", () => {
		const pair = generatePkcePair();
		expect(pair.method).toBe("S256");
		expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
		expect(pair.challenge).toBe(deriveCodeChallenge(pair.verifier));
	});

	it("generates fresh, non-repeating verifiers and states", () => {
		expect(createCodeVerifier()).not.toBe(createCodeVerifier());
		expect(generateOAuthState()).not.toBe(generateOAuthState());
	});
});
