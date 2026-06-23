import { describe, expect, it } from "bun:test";
import {
	filterGraphByArea,
	type GraphNode,
	type MemoryGraph,
	nodeAction,
	nodeFillClass,
	nodeRadius,
} from "./graphInteraction";

function node(
	overrides: Partial<GraphNode> & {
		id: string;
		kind: GraphNode["kind"];
		label: string;
	},
): GraphNode {
	return overrides as GraphNode;
}

describe("nodeAction", () => {
	it("maps a playbook node to select-playbook", () => {
		expect(
			nodeAction(
				node({
					id: "playbook:p1",
					kind: "playbook",
					label: "X",
					playbookId: "p1",
				}),
			),
		).toEqual({ type: "select-playbook", playbookId: "p1" });
	});

	it("maps a file node to open-file", () => {
		expect(
			nodeAction(
				node({ id: "file:a.ts", kind: "file", label: "a.ts", path: "a.ts" }),
			),
		).toEqual({ type: "open-file", path: "a.ts" });
	});

	it("maps an area node to filter-area", () => {
		expect(
			nodeAction(
				node({
					id: "area:frontend",
					kind: "area",
					label: "frontend",
					area: "frontend",
				}),
			),
		).toEqual({ type: "filter-area", area: "frontend" });
	});

	it("maps a practice node to none", () => {
		expect(
			nodeAction(
				node({
					id: "practice:project",
					kind: "practice",
					label: "Project practice",
				}),
			),
		).toEqual({ type: "none" });
	});
});

describe("nodeRadius / nodeFillClass", () => {
	it("sizes playbooks largest", () => {
		expect(nodeRadius("playbook")).toBeGreaterThan(nodeRadius("file"));
	});
	it("assigns a distinct class per kind", () => {
		const classes = new Set([
			nodeFillClass("playbook"),
			nodeFillClass("file"),
			nodeFillClass("area"),
			nodeFillClass("practice"),
		]);
		expect(classes.size).toBe(4);
	});
});

describe("filterGraphByArea", () => {
	const graph: MemoryGraph = {
		nodes: [
			node({ id: "playbook:a", kind: "playbook", label: "A", playbookId: "a" }),
			node({ id: "playbook:b", kind: "playbook", label: "B", playbookId: "b" }),
			node({
				id: "area:frontend",
				kind: "area",
				label: "frontend",
				area: "frontend",
			}),
			node({
				id: "area:backend",
				kind: "area",
				label: "backend",
				area: "backend",
			}),
			node({ id: "file:x.ts", kind: "file", label: "x.ts", path: "x.ts" }),
		],
		edges: [
			{ source: "playbook:a", target: "area:frontend", kind: "tagged" },
			{ source: "playbook:a", target: "file:x.ts", kind: "touches" },
			{ source: "playbook:b", target: "area:backend", kind: "tagged" },
		],
	};

	it("returns the graph unchanged when area is null", () => {
		expect(filterGraphByArea(graph, null)).toBe(graph);
	});

	it("keeps only the area + its playbooks + their files", () => {
		const filtered = filterGraphByArea(graph, "frontend");
		const ids = filtered.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["area:frontend", "file:x.ts", "playbook:a"]);
		// playbook:b (backend) is excluded.
		expect(ids).not.toContain("playbook:b");
	});

	it("returns the graph unchanged for an unknown area", () => {
		expect(filterGraphByArea(graph, "nonexistent")).toBe(graph);
	});
});
