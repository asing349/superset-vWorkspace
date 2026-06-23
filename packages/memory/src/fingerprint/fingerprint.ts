/**
 * Fingerprint helpers (PURE LOGIC). A fingerprint is a stable content hash
 * (optionally paired with a commit SHA elsewhere) used to detect when an
 * indexed entry has gone stale so it can decay/evict (B3). No Node deps — uses
 * a small, deterministic FNV-1a hash so the same content always yields the same
 * fingerprint in both Node and the browser.
 */

/**
 * 64-bit FNV-1a hash of a UTF-8 string, returned as a 16-char lowercase hex
 * string. Deterministic and dependency-free. Not cryptographic — collision
 * resistance is "good enough" for staleness detection, not security.
 */
export function contentHash(content: string): string {
	// FNV-1a 64-bit constants, computed with BigInt to stay exact.
	const FNV_OFFSET = 0xcbf29ce484222325n;
	const FNV_PRIME = 0x100000001b3n;
	const MASK = 0xffffffffffffffffn;

	let hash = FNV_OFFSET;
	for (let i = 0; i < content.length; i++) {
		// charCodeAt is sufficient and stable; we fold high code units in too.
		hash ^= BigInt(content.charCodeAt(i) & 0xff);
		hash = (hash * FNV_PRIME) & MASK;
		const high = content.charCodeAt(i) >> 8;
		if (high !== 0) {
			hash ^= BigInt(high);
			hash = (hash * FNV_PRIME) & MASK;
		}
	}
	return hash.toString(16).padStart(16, "0");
}

/**
 * Whether a freshly-computed hash differs from a previously-stored one. A
 * `null`/empty previous hash counts as "changed" (never indexed yet).
 */
export function isFingerprintStale(options: {
	previousHash: string | null | undefined;
	currentHash: string;
}): boolean {
	return (
		options.previousHash === null ||
		options.previousHash === undefined ||
		options.previousHash !== options.currentHash
	);
}
