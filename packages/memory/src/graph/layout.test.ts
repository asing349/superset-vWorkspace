import { describe, expect, it } from "bun:test";
import type { Playbook } from "../types";
import { buildMemoryGraph } from "./graph";
import { computeForceLayout } from "./layout";

function pb(
	id: string,
	paths: string[],
	areas: Playbook["areaTags"],
): Playbook {
	return {
		id,
		projectId: "p",
		intent: `task ${id}`,
		touchedPaths: paths,
		areaTags: areas,
		commands: [],
		gotcha: null,
		diffShape: null,
		validation: null,
		status: "confirmed",
		confidence: 80,
		provenance: { prNumber: null, url: null, taskId: null },
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("computeForceLayout", () => {
	const graph = buildMemoryGraph({
		playbooks: [
			pb("a", ["x.ts"], ["frontend"]),
			pb("b", ["y.ts"], ["backend"]),
		],
	});

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
