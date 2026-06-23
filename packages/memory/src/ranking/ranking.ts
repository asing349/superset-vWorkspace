import type { AreaTag } from "../types";

/**
 * Ranking helpers (PURE LOGIC) for B4 retrieval. B1 ships a cheap, deterministic
 * top-k by area overlap + recency so the retrieval bundle in B4 has a stable
 * scoring primitive to build on; B4 may layer semantic recall (B7) on top.
 */

/** Minimum shape a candidate must expose to be ranked. */
export interface RankableItem {
	/** Area tags of the candidate (e.g. a Playbook's `areaTags`). */
	areaTags: readonly AreaTag[];
	/** Epoch millis used for the recency component. */
	updatedAt: number;
}

export interface RankOptions {
	/** Areas of the current task/intent to match against. */
	queryAreas: readonly AreaTag[];
	/** How many items to return. Defaults to all when omitted. */
	topK?: number;
	/** Reference "now" for recency (epoch millis). Defaults to `Date.now()`. */
	now?: number;
	/**
	 * Recency half-life in days — score halves every this-many days of age.
	 * Defaults to 30.
	 */
	halfLifeDays?: number;
	/**
	 * Weight of the area-overlap component vs recency, in [0,1]. 1 = areas only,
	 * 0 = recency only. Defaults to 0.7 (area overlap dominates).
	 */
	areaWeight?: number;
}

export interface RankedItem<T> {
	item: T;
	score: number;
}

const DAY_MS = 86_400_000;

/** Jaccard-style overlap of two area sets, in [0,1]. */
function areaOverlap(a: readonly AreaTag[], b: readonly AreaTag[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const setB = new Set(b);
	let intersection = 0;
	const seen = new Set<AreaTag>();
	for (const tag of a) {
		if (seen.has(tag)) continue;
		seen.add(tag);
		if (setB.has(tag)) intersection += 1;
	}
	const union = new Set([...a, ...b]).size;
	return union === 0 ? 0 : intersection / union;
}

/** Exponential recency decay in [0,1] given an age. */
function recencyScore(
	updatedAt: number,
	now: number,
	halfLifeDays: number,
): number {
	const ageDays = Math.max(0, (now - updatedAt) / DAY_MS);
	return 0.5 ** (ageDays / halfLifeDays);
}

/**
 * Score and sort candidates by `areaWeight * areaOverlap + (1-areaWeight) *
 * recency`, descending, returning the top-k. Stable and side-effect-free.
 */
export function rankByAreaAndRecency<T extends RankableItem>(
	items: readonly T[],
	options: RankOptions,
): RankedItem<T>[] {
	const {
		queryAreas,
		topK,
		now = Date.now(),
		halfLifeDays = 30,
		areaWeight = 0.7,
	} = options;

	const scored = items.map((item) => {
		const area = areaOverlap(item.areaTags, queryAreas);
		const recency = recencyScore(item.updatedAt, now, halfLifeDays);
		const score = areaWeight * area + (1 - areaWeight) * recency;
		return { item, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return topK === undefined ? scored : scored.slice(0, Math.max(0, topK));
}
