/**
 * Embedding math (PURE LOGIC, B7). Brute-force cosine similarity + top-k over a
 * flat list of stored vectors. No ANN/vector library (Assumption A12) — at the
 * per-project file scale a linear scan is fine, and keeping it pure means it is
 * trivially testable and reusable from any context. No Node deps, no I/O.
 */

/** Loopback hosts the embeddings client is allowed to contact (B7 net rule). */
export const LOOPBACK_HOSTS = new Set<string>([
	"127.0.0.1",
	"localhost",
	"[::1]",
	"::1",
	"0.0.0.0",
]);

/**
 * Whether a URL points at an explicitly-LOCAL loopback host. Used to HARD-GATE
 * the embeddings client so it can never contact a cloud/non-local provider.
 * Returns false for anything that doesn't parse or isn't loopback.
 */
export function isLoopbackUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return false;
	}
	// `hostname` strips brackets from IPv6; normalize a couple of forms.
	const host = parsed.hostname.toLowerCase();
	return (
		LOOPBACK_HOSTS.has(host) || host === "::1" || host.endsWith(".localhost")
	);
}

/** Dot product of two equal-length vectors (0 when lengths differ). */
export function dot(a: readonly number[], b: readonly number[]): number {
	if (a.length !== b.length) return 0;
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		sum += (a[i] as number) * (b[i] as number);
	}
	return sum;
}

/** Euclidean norm of a vector. */
export function norm(a: readonly number[]): number {
	let sum = 0;
	for (const value of a) sum += value * value;
	return Math.sqrt(sum);
}

/**
 * Cosine similarity in [-1, 1]; 0 when either vector is zero-length, empty, or
 * the lengths differ. Never throws.
 */
export function cosineSimilarity(
	a: readonly number[],
	b: readonly number[],
): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	const denom = norm(a) * norm(b);
	if (denom === 0) return 0;
	return dot(a, b) / denom;
}

export interface StoredVector<TMeta = unknown> {
	vector: number[];
	meta: TMeta;
}

export interface ScoredVector<TMeta = unknown> {
	score: number;
	meta: TMeta;
}

/**
 * Rank stored vectors by cosine similarity to a query vector, descending,
 * returning the top-k (default all). Optionally drop matches below `minScore`.
 */
export function topKBySimilarity<TMeta>(options: {
	query: readonly number[];
	items: ReadonlyArray<StoredVector<TMeta>>;
	topK?: number;
	minScore?: number;
}): ScoredVector<TMeta>[] {
	const { query, items, topK, minScore = -1 } = options;
	const scored = items
		.map((item) => ({
			score: cosineSimilarity(query, item.vector),
			meta: item.meta,
		}))
		.filter((s) => s.score >= minScore);
	scored.sort((a, b) => b.score - a.score);
	return topK === undefined ? scored : scored.slice(0, Math.max(0, topK));
}
