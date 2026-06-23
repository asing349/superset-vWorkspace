import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Pure decision logic for the in-panel knowledge graph (B6). No React/SVG —
 * maps a clicked node to a UI action and provides small layout/visual helpers,
 * so the graph component stays declarative and the behavior is unit-testable.
 */

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type MemoryGraph = RouterOutputs["memory"]["graph"];
export type GraphNode = MemoryGraph["nodes"][number];
export type GraphEdge = MemoryGraph["edges"][number];
export type GraphNodeKind = GraphNode["kind"];

/** The action the panel should take when a graph node is clicked. */
export type NodeAction =
	| { type: "select-playbook"; playbookId: string }
	| { type: "open-file"; path: string }
	| { type: "filter-area"; area: string }
	| { type: "none" };

/**
 * Map a clicked node to an action:
 *  - playbook → select it in the Playbooks section (reuse `selectedPlaybookId`)
 *  - file     → open that file (best-effort)
 *  - area     → filter the graph to that area
 *  - practice → no-op (no target to open from the graph)
 */
export function nodeAction(node: GraphNode): NodeAction {
	switch (node.kind) {
		case "playbook":
			return node.playbookId
				? { type: "select-playbook", playbookId: node.playbookId }
				: { type: "none" };
		case "file":
			return node.path
				? { type: "open-file", path: node.path }
				: { type: "none" };
		case "area":
			return node.area
				? { type: "filter-area", area: node.area }
				: { type: "none" };
		default:
			return { type: "none" };
	}
}

/** A node's render radius by kind (playbooks are the focal nodes). */
export function nodeRadius(kind: GraphNodeKind): number {
	switch (kind) {
		case "playbook":
			return 9;
		case "practice":
			return 8;
		case "area":
			return 6;
		default:
			return 5;
	}
}

/** A tailwind-ish fill class per node kind (kept here so it's testable). */
export function nodeFillClass(kind: GraphNodeKind): string {
	switch (kind) {
		case "playbook":
			return "fill-sky-500";
		case "file":
			return "fill-muted-foreground";
		case "area":
			return "fill-emerald-500";
		case "practice":
			return "fill-amber-500";
	}
}

/**
 * Filter a graph to nodes connected to a given area (the area node, every
 * playbook tagged with it, and those playbooks' files), plus the edges among
 * them. Returns the original graph unchanged when `area` is null.
 */
export function filterGraphByArea(
	graph: MemoryGraph,
	area: string | null,
): MemoryGraph {
	if (!area) return graph;
	const areaNodeId = `area:${area}`;
	if (!graph.nodes.some((n) => n.id === areaNodeId)) return graph;

	// Playbooks tagged with the area.
	const taggedPlaybooks = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.kind === "tagged" && edge.target === areaNodeId) {
			taggedPlaybooks.add(edge.source);
		}
	}

	const keep = new Set<string>([areaNodeId, ...taggedPlaybooks]);
	// Include the files/areas/practice those playbooks touch.
	for (const edge of graph.edges) {
		if (taggedPlaybooks.has(edge.source)) {
			keep.add(edge.source);
			keep.add(edge.target);
		}
	}

	const nodes = graph.nodes.filter((n) => keep.has(n.id));
	const edges = graph.edges.filter(
		(e) => keep.has(e.source) && keep.has(e.target),
	);
	return { nodes, edges };
}
