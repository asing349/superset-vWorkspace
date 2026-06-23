import { describe, expect, it } from "bun:test";
import type { MemoryGraph } from "../graphInteraction";
import { computeForceLayout } from "./forceLayout";

const graph: MemoryGraph = {
	nodes: [
		{ id: "playbook:a", kind: "playbook", label: "A", playbookId: "a" },
		{ id: "file:x.ts", kind: "file", label: "x.ts", path: "x.ts" },
		{ id: "area:frontend", kind: "area", label: "frontend", area: "frontend" },
	],
	edges: [
		{ source: "playbook:a", target: "file:x.ts", kind: "touches" },
		{ source: "playbook:a", target: "area:frontend", kind: "tagged" },
	],
};

describe("computeForceLayout (renderer)", () => {
	it("places every node within the viewport bounds", () => {
		const layout = computeForceLayout(graph, { width: 400, height: 300 });
		expect(layout.size).toBe(graph.nodes.length);
		for (const node of graph.nodes) {
			const pos = layout.get(node.id);
			expect(pos).toBeDefined();
			expect(pos?.x).toBeGreaterThanOrEqual(0);
			expect(pos?.x).toBeLessThanOrEqual(400);
			expect(pos?.y).toBeGreaterThanOrEqual(0);
			expect(pos?.y).toBeLessThanOrEqual(300);
		}
	});

	it("is deterministic for the same graph + seed", () => {
		const a = computeForceLayout(graph, { seed: 7 });
		const b = computeForceLayout(graph, { seed: 7 });
		for (const node of graph.nodes) {
			expect(a.get(node.id)).toEqual(b.get(node.id));
		}
	});

	it("returns an empty map for an empty graph", () => {
		expect(computeForceLayout({ nodes: [], edges: [] }).size).toBe(0);
	});
});
