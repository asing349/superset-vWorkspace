import type { AreaTag, Playbook } from "../types";

/**
 * Knowledge-graph assembly (PURE LOGIC, B6). Turn the local memory rows into a
 * typed node/edge graph — playbooks ↔ files ↔ area tags, plus playbook↔playbook
 * similarity and playbook→practice edges. No Node, no I/O — the host supplies
 * the rows; this is unit-testable and reused by both the `memory.graph` tRPC
 * procedure and the renderer's inline graph view.
 */

export type GraphNodeKind = "playbook" | "file" | "area" | "practice";

export interface GraphNode {
	/** Stable id, namespaced by kind (e.g. "playbook:<id>", "file:<path>"). */
	id: string;
	kind: GraphNodeKind;
	/** Human label for the node. */
	label: string;
	/** Playbook id for `kind: "playbook"` (lets the UI select it). */
	playbookId?: string;
	/** Repo-relative path for `kind: "file"` (lets the UI open it). */
	path?: string;
	/** Area tag for `kind: "area"` (lets the UI filter). */
	area?: AreaTag;
	/** Playbook status for `kind: "playbook"` (drives node tint). */
	status?: Playbook["status"];
}

export type GraphEdgeKind = "touches" | "tagged" | "similar" | "practice";

export interface GraphEdge {
	source: string;
	target: string;
	kind: GraphEdgeKind;
	/** Strength in (0,1], used for similarity edge weighting. */
	weight?: number;
}

export interface MemoryGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface BuildGraphOptions {
	playbooks: readonly Playbook[];
	/** Practice scopes that exist, to add a practice node + edges. */
	practices?: ReadonlyArray<{ scope: "project" | "global" }>;
	/**
	 * Minimum similarity (0..1) for a playbook↔playbook edge. Default 0.34 so a
	 * single shared area on a 2-area pair clears it but unrelated pairs don't.
	 */
	minSimilarity?: number;
	/** Include playbooks with these statuses. Default confirmed + provisional. */
	statuses?: ReadonlyArray<Playbook["status"]>;
}

const DEFAULT_MIN_SIMILARITY = 0.34;
const DEFAULT_STATUSES: ReadonlyArray<Playbook["status"]> = [
	"confirmed",
	"provisional",
];

export function playbookNodeId(playbookId: string): string {
	return `playbook:${playbookId}`;
}
export function fileNodeId(path: string): string {
	return `file:${path}`;
}
export function areaNodeId(area: AreaTag): string {
	return `area:${area}`;
}
export function practiceNodeId(scope: "project" | "global"): string {
	return `practice:${scope}`;
}

/** Jaccard similarity of two string sets (0 when both empty). */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const x of a) {
		if (b.has(x)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/**
 * Similarity between two playbooks: the average of their area-tag Jaccard and
 * their touched-path Jaccard. Captures "same kind of work" (areas) AND "same
 * place in the codebase" (paths). Deterministic.
 */
export function playbookSimilarity(a: Playbook, b: Playbook): number {
	const areaSim = jaccard(new Set(a.areaTags), new Set(b.areaTags));
	const pathSim = jaccard(new Set(a.touchedPaths), new Set(b.touchedPaths));
	return (areaSim + pathSim) / 2;
}

/**
 * Build the memory knowledge graph. Nodes: one per included playbook, one per
 * distinct touched file, one per distinct area tag, and (optionally) one per
 * existing practice scope. Edges: playbook→file (`touches`), playbook→area
 * (`tagged`), playbook↔playbook (`similar`, above the threshold), and
 * playbook→practice (`practice`). De-duped + deterministically ordered.
 */
export function buildMemoryGraph(options: BuildGraphOptions): MemoryGraph {
	const {
		playbooks,
		practices = [],
		minSimilarity = DEFAULT_MIN_SIMILARITY,
		statuses = DEFAULT_STATUSES,
	} = options;

	const allowed = new Set(statuses);
	const included = playbooks
		.filter((p) => allowed.has(p.status))
		.slice()
		.sort((a, b) => a.id.localeCompare(b.id));

	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];
	const addNode = (node: GraphNode): void => {
		if (!nodes.has(node.id)) nodes.set(node.id, node);
	};

	for (const playbook of included) {
		addNode({
			id: playbookNodeId(playbook.id),
			kind: "playbook",
			label: playbook.intent,
			playbookId: playbook.id,
			status: playbook.status,
		});

		for (const path of [...new Set(playbook.touchedPaths)].sort()) {
			addNode({
				id: fileNodeId(path),
				kind: "file",
				label: basename(path),
				path,
			});
			edges.push({
				source: playbookNodeId(playbook.id),
				target: fileNodeId(path),
				kind: "touches",
			});
		}

		for (const area of [...new Set(playbook.areaTags)].sort()) {
			addNode({
				id: areaNodeId(area),
				kind: "area",
				label: area,
				area,
			});
			edges.push({
				source: playbookNodeId(playbook.id),
				target: areaNodeId(area),
				kind: "tagged",
			});
		}
	}

	// Practice nodes + edges from every included playbook (the practice is
	// distilled from confirmed playbooks, so they all relate to it).
	for (const { scope } of practices) {
		addNode({
			id: practiceNodeId(scope),
			kind: "practice",
			label: `${scope === "global" ? "Global" : "Project"} practice`,
		});
		for (const playbook of included) {
			if (playbook.status !== "confirmed") continue;
			edges.push({
				source: playbookNodeId(playbook.id),
				target: practiceNodeId(scope),
				kind: "practice",
			});
		}
	}

	// Similarity edges (undirected, emitted once per pair, i<j by sorted id).
	for (let i = 0; i < included.length; i++) {
		for (let j = i + 1; j < included.length; j++) {
			const a = included[i] as Playbook;
			const b = included[j] as Playbook;
			const weight = playbookSimilarity(a, b);
			if (weight >= minSimilarity) {
				edges.push({
					source: playbookNodeId(a.id),
					target: playbookNodeId(b.id),
					kind: "similar",
					weight: Math.round(weight * 100) / 100,
				});
			}
		}
	}

	return { nodes: [...nodes.values()], edges };
}

/** POSIX basename of a repo-relative path (pure; no Node path). */
export function basename(path: string): string {
	const cleaned = path.replace(/\/+$/, "");
	const idx = cleaned.lastIndexOf("/");
	return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}
