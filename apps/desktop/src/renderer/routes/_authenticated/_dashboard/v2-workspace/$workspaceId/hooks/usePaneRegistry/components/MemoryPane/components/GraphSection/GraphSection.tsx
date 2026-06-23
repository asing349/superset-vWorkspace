import { Button } from "@superset/ui/button";
import { useState } from "react";
import { LuRefreshCw, LuX } from "react-icons/lu";
import type { UseMemoryGraphResult } from "../../hooks/useMemoryGraph";
import {
	filterGraphByArea,
	type GraphNode,
	nodeAction,
} from "../../utils/graphInteraction";
import { MemoryGraphView } from "../MemoryGraphView";

interface GraphSectionProps {
	graph: UseMemoryGraphResult;
	/** Select a playbook (switches to the Playbooks section + opens its detail). */
	onSelectPlaybook: (playbookId: string) => void;
	/** Open a touched file (best-effort; repo-relative path). */
	onOpenFile?: (path: string) => void;
}

/**
 * The knowledge-graph section (B6): the inline SVG graph + a legend, a
 * "Regenerate vault" action, and an area filter. Clicking a node selects a
 * playbook, opens a file, or filters by area.
 */
export function GraphSection({
	graph,
	onSelectPlaybook,
	onOpenFile,
}: GraphSectionProps) {
	const [areaFilter, setAreaFilter] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	const shown = filterGraphByArea(graph.graph, areaFilter);

	const handleNodeClick = (node: GraphNode) => {
		setSelectedNodeId(node.id);
		const action = nodeAction(node);
		switch (action.type) {
			case "select-playbook":
				onSelectPlaybook(action.playbookId);
				break;
			case "open-file":
				onOpenFile?.(action.path);
				break;
			case "filter-area":
				setAreaFilter((prev) => (prev === action.area ? null : action.area));
				break;
			default:
				break;
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<Legend />
				{areaFilter ? (
					<Button
						variant="outline"
						size="xs"
						className="ml-2"
						onClick={() => setAreaFilter(null)}
					>
						<LuX className="size-3" />
						{areaFilter}
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="xs"
					className="ml-auto"
					onClick={graph.regenerateVault}
					disabled={graph.isRegenerating}
					title="Write the Obsidian vault under ~/.superset/memory/vault/"
				>
					<LuRefreshCw className="size-3.5" />
					Regenerate vault
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<MemoryGraphView
					graph={shown}
					selectedNodeId={selectedNodeId}
					onNodeClick={handleNodeClick}
				/>
			</div>
		</div>
	);
}

function Legend() {
	const items: { label: string; className: string }[] = [
		{ label: "Playbook", className: "bg-sky-500" },
		{ label: "File", className: "bg-muted-foreground" },
		{ label: "Area", className: "bg-emerald-500" },
		{ label: "Practice", className: "bg-amber-500" },
	];
	return (
		<div className="flex items-center gap-3 text-[11px] text-muted-foreground select-none">
			{items.map((item) => (
				<span key={item.label} className="flex items-center gap-1">
					<span className={`size-2 rounded-full ${item.className}`} />
					{item.label}
				</span>
			))}
		</div>
	);
}
