import { describe, expect, test } from "bun:test";
import {
	buildTicketContext,
	type MemoryBundle,
	type TicketContextSource,
} from "./buildTicketContext";

const ticket: TicketContextSource = {
	slug: "SUPER-172",
	title: "Add the ticket context builder",
	description: "Assemble a draft context from the ticket and memory.",
	externalKey: "SUPER-172",
	externalUrl: "https://linear.app/superset/issue/SUPER-172",
};

function emptyBundle(overrides: Partial<MemoryBundle> = {}): MemoryBundle {
	return {
		queryAreas: [],
		practices: [],
		playbooks: [],
		indexSlices: [],
		semanticSlices: [],
		estimatedTokens: 0,
		estimatedTokensBeforeCap: 0,
		trimmed: false,
		projectId: null,
		intent: "",
		...overrides,
	} as MemoryBundle;
}

describe("buildTicketContext", () => {
	test("includes the ticket title, key and description", () => {
		const out = buildTicketContext({
			ticket,
			developerInput: "",
			bundle: null,
		});
		expect(out).toContain("## Ticket");
		expect(out).toContain("**SUPER-172** — Add the ticket context builder");
		expect(out).toContain(
			"Assemble a draft context from the ticket and memory.",
		);
		expect(out).toContain("Link: https://linear.app/superset/issue/SUPER-172");
	});

	test("omits the developer section when input is empty/whitespace", () => {
		const out = buildTicketContext({
			ticket,
			developerInput: "   ",
			bundle: null,
		});
		expect(out).not.toContain("Developer-provided context");
	});

	test("includes the developer section when input is provided", () => {
		const out = buildTicketContext({
			ticket,
			developerInput: "Focus on the renderer only.",
			bundle: null,
		});
		expect(out).toContain("## Developer-provided context");
		expect(out).toContain("Focus on the renderer only.");
	});

	test("falls back to a placeholder when the ticket has no description", () => {
		const out = buildTicketContext({
			ticket: { ...ticket, description: null },
			developerInput: "",
			bundle: null,
		});
		expect(out).toContain("_No description provided._");
	});

	test("renders practices, playbooks, index and semantic slices from the bundle", () => {
		const bundle = emptyBundle({
			practices: [
				{ scope: "project", content: "Use object params.", version: 3 },
				{ scope: "global", content: "Bun only.", version: null },
			],
			playbooks: [
				{
					id: "pb-1",
					intent: "Wire a host tRPC query into the renderer",
					areaTags: ["desktop", "trpc"],
					commands: ["bun run typecheck"],
					gotcha: "Renderer cannot import Node modules.",
					diffShape: "new hook + provider wrapper",
					validation: "typecheck clean",
					status: "confirmed",
					confidence: 0.9,
					score: 1.2,
				},
			],
			indexSlices: [
				{
					path: "apps/desktop/src/renderer/x.ts",
					areaTags: ["desktop"],
					summary: "where X lives",
					score: 0.5,
				},
			],
			semanticSlices: [
				{
					path: "packages/memory/src/retrieval/retrieval.ts",
					summary: "RetrievalBundle type",
					similarity: 0.81,
				},
			],
		} as Partial<MemoryBundle>);

		const out = buildTicketContext({
			ticket,
			developerInput: "",
			bundle,
		});

		expect(out).toContain("## Coding practices");
		expect(out).toContain("### project practice (v3)");
		expect(out).toContain("Use object params.");
		expect(out).toContain("### global practice");
		expect(out).toContain("## Relevant playbooks");
		expect(out).toContain("Wire a host tRPC query into the renderer");
		expect(out).toContain("`bun run typecheck`");
		expect(out).toContain("Gotcha: Renderer cannot import Node modules.");
		expect(out).toContain("## Project index");
		expect(out).toContain("`apps/desktop/src/renderer/x.ts` — where X lives");
		expect(out).toContain("## Related code (semantic recall)");
		expect(out).toContain("RetrievalBundle type");
	});

	test("orders ticket before developer input before memory", () => {
		const bundle = emptyBundle({
			practices: [{ scope: "global", content: "Bun only.", version: null }],
		} as Partial<MemoryBundle>);
		const out = buildTicketContext({
			ticket,
			developerInput: "Some context.",
			bundle,
		});
		const ticketIdx = out.indexOf("## Ticket");
		const devIdx = out.indexOf("## Developer-provided context");
		const practiceIdx = out.indexOf("## Coding practices");
		expect(ticketIdx).toBeGreaterThanOrEqual(0);
		expect(devIdx).toBeGreaterThan(ticketIdx);
		expect(practiceIdx).toBeGreaterThan(devIdx);
	});

	test("never truncates: all retrieved playbooks are included", () => {
		const playbooks = Array.from({ length: 40 }, (_, i) => ({
			id: `pb-${i}`,
			intent: `Playbook number ${i}`,
			areaTags: [],
			commands: [],
			gotcha: null,
			diffShape: null,
			validation: null,
			status: "confirmed" as const,
			confidence: 0.5,
			score: 1,
		}));
		const out = buildTicketContext({
			ticket,
			developerInput: "",
			bundle: emptyBundle({ playbooks } as Partial<MemoryBundle>),
		});
		for (let i = 0; i < 40; i++) {
			expect(out).toContain(`Playbook number ${i}`);
		}
	});
});
