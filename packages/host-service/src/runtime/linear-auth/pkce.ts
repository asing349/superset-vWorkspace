import { createHash, randomBytes } from "node:crypto";

// Wave-7 M1 — PKCE (RFC 7636) helpers for the host-local Linear OAuth flow.
// The verifier never leaves the host; only the S256 challenge is sent on the
// authorize request, and the verifier is replayed on the token exchange. No
// client secret is involved anywhere.

export interface PkcePair {
	verifier: string;
	challenge: string;
	method: "S256";
}

function base64UrlEncode(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * A high-entropy `code_verifier`. 32 random bytes → a 43-char base64url
 * string, comfortably inside RFC 7636's 43–128 char range.
 */
export function createCodeVerifier(): string {
	return base64UrlEncode(randomBytes(32));
}

/**
 * The S256 `code_challenge` for a verifier:
 * `BASE64URL(SHA256(ASCII(verifier)))`.
 */
export function deriveCodeChallenge(verifier: string): string {
	return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export function generatePkcePair(): PkcePair {
	const verifier = createCodeVerifier();
	return {
		verifier,
		challenge: deriveCodeChallenge(verifier),
		method: "S256",
	};
}

/** An opaque CSRF `state` token echoed through the authorize redirect. */
export function generateOAuthState(): string {
	return base64UrlEncode(randomBytes(16));
}
