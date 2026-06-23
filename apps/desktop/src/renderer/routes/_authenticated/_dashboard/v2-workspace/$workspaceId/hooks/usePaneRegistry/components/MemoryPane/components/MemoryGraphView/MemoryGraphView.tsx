import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { computeForceLayout } from "../../utils/forceLayout";
import {
	type GraphNode,
	type MemoryGraph,
	nodeFillClass,
	nodeRadius,
} from "../../utils/graphInteraction";

const WIDTH = 800;
const HEIGHT = 600;

const EDGE_CLASS: Record<MemoryGraph["edges"][number]["kind"], string> = {
	touches: "stroke-border",
	tagged: "stroke-emerald-500/40",
	similar: "stroke-sky-500/50",
	practice: "stroke-amber-500/40",
};

/**
 * Inline SVG knowledge-graph view (B6). Uses the pure, deterministic
 * `computeForceLayout` from the RENDERER-LOCAL copy in `../../utils/forceLayout`
 * (no graph-lib dependency, A12). The renderer is not a dependency of
 * `@superset/memory`, so the force layout is duplicated browser-side rather than
 * imported from that package (the canonical copy lives in `@superset/memory` for
 * the host + its tests). Nodes are clickable; the parent maps the click to an
 * action (select playbook / open file / filter area).
 */
export function MemoryGraphView({
	graph,
	selectedNodeId,
	onNodeClick,
}: {
	graph: MemoryGraph;
	selectedNodeId?: string | null;
	onNodeClick: (node: GraphNode) => void;
}) {
	// Layout is keyed by node/edge identity so it only recomputes when the graph
	// changes (stable across re-renders / selection changes).
	const layout = useMemo(
		() => computeForceLayout(graph, { width: WIDTH, height: HEIGHT, seed: 1 }),
		[graph],
	);

	if (graph.nodes.length === 0) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground select-text">
				No memory to graph yet. Save a PR to memory to seed playbooks.
			</div>
		);
	}

	return (
		<svg
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			preserveAspectRatio="xMidYMid meet"
			className="h-full w-full"
			role="img"
			aria-label="Memory knowledge graph"
		>
			<g>
				{graph.edges.map((edge) => {
					const a = layout.get(edge.source);
					const b = layout.get(edge.target);
					if (!a || !b) return null;
					return (
						<line
							key={`${edge.source}->${edge.target}:${edge.kind}`}
							x1={a.x}
							y1={a.y}
							x2={b.x}
							y2={b.y}
							className={cn(EDGE_CLASS[edge.kind], "stroke-[1.5]")}
						/>
					);
				})}
			</g>
			<g>
				{graph.nodes.map((node) => {
					const pos = layout.get(node.id);
					if (!pos) return null;
					const isSelected = node.id === selectedNodeId;
					return (
						// biome-ignore lint/a11y/useSemanticElements: an SVG <g> cannot be a <button>; role+tabIndex+keydown give it real keyboard accessibility
						<g
							key={node.id}
							transform={`translate(${pos.x}, ${pos.y})`}
							className="cursor-pointer outline-none"
							role="button"
							tabIndex={0}
							aria-label={`${node.kind}: ${node.label}`}
							onClick={() => onNodeClick(node)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onNodeClick(node);
								}
							}}
						>
							<title>{node.label}</title>
							<circle
								r={nodeRadius(node.kind) + (isSelected ? 3 : 0)}
								className={cn(
									nodeFillClass(node.kind),
									isSelected && "stroke-foreground stroke-2",
								)}
							/>
							{node.kind === "playbook" || node.kind === "area" ? (
								<text
									x={nodeRadius(node.kind) + 4}
									y={3}
									className="pointer-events-none fill-foreground text-[9px]"
								>
									{truncate(node.label, 28)}
								</text>
							) : null}
						</g>
					);
				})}
			</g>
		</svg>
	);
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
