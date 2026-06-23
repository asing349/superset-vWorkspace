import type { MemoryGraph } from "./graph";

/**
 * A tiny, deterministic force-directed layout (PURE LOGIC, B6) for the inline
 * SVG graph view — no graph-lib dependency (A12). Seeded initial placement +
 * fixed iteration count so the same graph always lays out identically (no
 * animation jitter, easy to snapshot/test). Not a production physics sim; just
 * enough to spread nodes legibly.
 */

export interface LayoutNode {
	id: string;
	x: number;
	y: number;
}

export interface LayoutOptions {
	width?: number;
	height?: number;
	iterations?: number;
	/** Deterministic seed for initial placement. */
	seed?: number;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_ITERATIONS = 120;

/** Deterministic [0,1) PRNG (mulberry32) so layouts are reproducible. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Compute node positions for a graph. Returns a map of node id → {x,y} within
 * `[0,width] × [0,height]`. Deterministic given the same graph + options.
 */
export function computeForceLayout(
	graph: MemoryGraph,
	options: LayoutOptions = {},
): Map<string, LayoutNode> {
	const {
		width = DEFAULT_WIDTH,
		height = DEFAULT_HEIGHT,
		iterations = DEFAULT_ITERATIONS,
		seed = 1,
	} = options;

	const rng = mulberry32(seed);
	const positions = new Map<string, LayoutNode>();
	const cx = width / 2;
	const cy = height / 2;
	const n = graph.nodes.length;
	if (n === 0) return positions;

	// Seed on a circle (deterministic, avoids degenerate all-overlap starts).
	graph.nodes.forEach((node, i) => {
		const angle = (i / n) * Math.PI * 2 + rng() * 0.1;
		const radius = Math.min(width, height) * 0.35;
		positions.set(node.id, {
			id: node.id,
			x: cx + Math.cos(angle) * radius,
			y: cy + Math.sin(angle) * radius,
		});
	});

	const k = Math.sqrt((width * height) / n); // ideal edge length
	const adjacency = graph.edges.map((e) => ({
		a: e.source,
		b: e.target,
	}));

	for (let iter = 0; iter < iterations; iter++) {
		const cooling = 1 - iter / iterations;
		const disp = new Map<string, { dx: number; dy: number }>();
		for (const node of graph.nodes) disp.set(node.id, { dx: 0, dy: 0 });

		// Repulsion (all pairs).
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const ni = graph.nodes[i];
				const nj = graph.nodes[j];
				if (!ni || !nj) continue;
				const pi = positions.get(ni.id);
				const pj = positions.get(nj.id);
				if (!pi || !pj) continue;
				let dx = pi.x - pj.x;
				let dy = pi.y - pj.y;
				let dist = Math.hypot(dx, dy);
				if (dist < 0.01) {
					dx = (rng() - 0.5) * 0.1;
					dy = (rng() - 0.5) * 0.1;
					dist = Math.hypot(dx, dy) || 0.01;
				}
				const force = (k * k) / dist;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				const di = disp.get(ni.id);
				const dj = disp.get(nj.id);
				if (di) {
					di.dx += fx;
					di.dy += fy;
				}
				if (dj) {
					dj.dx -= fx;
					dj.dy -= fy;
				}
			}
		}

		// Attraction (along edges).
		for (const { a, b } of adjacency) {
			const pa = positions.get(a);
			const pb = positions.get(b);
			if (!pa || !pb) continue;
			const dx = pa.x - pb.x;
			const dy = pa.y - pb.y;
			const dist = Math.hypot(dx, dy) || 0.01;
			const force = (dist * dist) / k;
			const fx = (dx / dist) * force;
			const fy = (dy / dist) * force;
			const da = disp.get(a);
			const db = disp.get(b);
			if (da) {
				da.dx -= fx;
				da.dy -= fy;
			}
			if (db) {
				db.dx += fx;
				db.dy += fy;
			}
		}

		// Apply, cool, and clamp to the viewport.
		const maxStep = k * cooling;
		for (const node of graph.nodes) {
			const p = positions.get(node.id);
			const d = disp.get(node.id);
			if (!p || !d) continue;
			const dl = Math.hypot(d.dx, d.dy) || 0.01;
			p.x += (d.dx / dl) * Math.min(dl, maxStep);
			p.y += (d.dy / dl) * Math.min(dl, maxStep);
			p.x = Math.max(20, Math.min(width - 20, p.x));
			p.y = Math.max(20, Math.min(height - 20, p.y));
		}
	}

	return positions;
}
