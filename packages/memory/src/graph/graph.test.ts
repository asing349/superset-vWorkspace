import { describe, expect, it } from "bun:test";
import type { Playbook } from "../types";
import {
	areaNodeId,
	buildMemoryGraph,
	fileNodeId,
	playbookNodeId,
	playbookSimilarity,
	practiceNodeId,
} from "./graph";

function pb(overrides: Partial<Playbook> = {}): Playbook {
	return {
		id: overrides.id ?? "pb-1",
		projectId: overrides.projectId ?? "proj-1",
		intent: overrides.intent ?? "Do a thing",
		touchedPaths: overrides.touchedPaths ?? ["apps/web/src/x.ts"],
		areaTags: overrides.areaTags ?? ["frontend"],
		commands: overrides.commands ?? [],
		gotcha: overrides.gotcha ?? null,
		diffShape: overrides.diffShape ?? null,
		validation: overrides.validation ?? null,
		status: overrides.status ?? "confirmed",
		confidence: overrides.confidence ?? 80,
		provenance: overrides.provenance ?? {
			prNumber: null,
			url: null,
			taskId: null,
		},
		createdAt: overrides.createdAt ?? 1,
		updatedAt: overrides.updatedAt ?? 1,
	};
}

describe("buildMemoryGraph", () => {
	it("creates playbook, file, and area nodes with touches/tagged edges", () => {
		const graph = buildMemoryGraph({
			playbooks: [
				pb({
					id: "a",
					touchedPaths: ["apps/web/src/x.ts"],
					areaTags: ["frontend"],
				}),
			],
		});
		const ids = graph.nodes.map((n) => n.id).sort();
		expect(ids).toContain(playbookNodeId("a"));
		expect(ids).toContain(fileNodeId("apps/web/src/x.ts"));
		expect(ids).toContain(areaNodeId("frontend"));

		expect(
			graph.edges.some(
				(e) =>
					e.kind === "touches" &&
					e.source === playbookNodeId("a") &&
					e.target === fileNodeId("apps/web/src/x.ts"),
			),
		).toBe(true);
		expect(graph.edges.some((e) => e.kind === "tagged")).toBe(true);
	});

	it("de-dupes shared files/areas across playbooks into single nodes", () => {
		const graph = buildMemoryGraph({
			playbooks: [
				pb({ id: "a", touchedPaths: ["shared.ts"], areaTags: ["backend"] }),
				pb({ id: "b", touchedPaths: ["shared.ts"], areaTags: ["backend"] }),
			],
			minSimilarity: 2, // suppress similarity edges to isolate node de-dup
		});
		const fileNodes = graph.nodes.filter((n) => n.kind === "file");
		const areaNodes = graph.nodes.filter((n) => n.kind === "area");
		expect(fileNodes).toHaveLength(1);
		expect(areaNodes).toHaveLength(1);
	});

	it("adds a similarity edge between playbooks sharing areas + paths", () => {
		const graph = buildMemoryGraph({
			playbooks: [
				pb({ id: "a", touchedPaths: ["x.ts"], areaTags: ["frontend"] }),
				pb({ id: "b", touchedPaths: ["x.ts"], areaTags: ["frontend"] }),
				pb({ id: "c", touchedPaths: ["z.ts"], areaTags: ["backend"] }),
			],
		});
		const similar = graph.edges.filter((e) => e.kind === "similar");
		// a↔b are identical (sim 1); c shares nothing.
		expect(
			similar.some(
				(e) =>
					(e.source === playbookNodeId("a") &&
						e.target === playbookNodeId("b")) ||
					(e.source === playbookNodeId("b") &&
						e.target === playbookNodeId("a")),
			),
		).toBe(true);
		expect(
			similar.some(
				(e) =>
					e.source === playbookNodeId("c") || e.target === playbookNodeId("c"),
			),
		).toBe(false);
	});

	it("adds practice nodes + edges from confirmed playbooks only", () => {
		const graph = buildMemoryGraph({
			playbooks: [
				pb({ id: "a", status: "confirmed" }),
				pb({ id: "b", status: "provisional" }),
			],
			practices: [{ scope: "project" }],
		});
		expect(graph.nodes.some((n) => n.id === practiceNodeId("project"))).toBe(
			true,
		);
		const practiceEdges = graph.edges.filter((e) => e.kind === "practice");
		expect(practiceEdges).toHaveLength(1);
		expect(practiceEdges[0]?.source).toBe(playbookNodeId("a"));
	});

	it("filters by status (excludes demoted/archived by default)", () => {
		const graph = buildMemoryGraph({
			playbooks: [
				pb({ id: "a", status: "confirmed" }),
				pb({ id: "b", status: "demoted" }),
			],
		});
		const playbookNodes = graph.nodes.filter((n) => n.kind === "playbook");
		expect(playbookNodes.map((n) => n.playbookId)).toEqual(["a"]);
	});

	it("is deterministic (stable node + edge ordering)", () => {
		const playbooks = [
			pb({ id: "b", touchedPaths: ["x.ts"] }),
			pb({ id: "a", touchedPaths: ["x.ts"] }),
		];
		const g1 = buildMemoryGraph({ playbooks });
		const g2 = buildMemoryGraph({ playbooks });
		expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
	});
});

describe("playbookSimilarity", () => {
	it("is 1 for identical area+path sets and 0 for disjoint", () => {
		expect(
			playbookSimilarity(
				pb({ touchedPaths: ["x"], areaTags: ["frontend"] }),
				pb({ touchedPaths: ["x"], areaTags: ["frontend"] }),
			),
		).toBe(1);
		expect(
			playbookSimilarity(
				pb({ touchedPaths: ["x"], areaTags: ["frontend"] }),
				pb({ touchedPaths: ["y"], areaTags: ["backend"] }),
			),
		).toBe(0);
	});
});
