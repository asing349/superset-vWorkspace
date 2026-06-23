import { describe, expect, it } from "bun:test";
import { createInMemoryMemoryMcpClient } from "./in-memory";
import type {
	MemoryDataProvider,
	MemoryPlaybookDetail,
	MemoryPracticeResult,
	MemorySearchResult,
} from "./types";

function fakeProvider(
	overrides: Partial<MemoryDataProvider> = {},
): MemoryDataProvider {
	const search: MemorySearchResult = {
		queryAreas: ["backend"],
		practices: [{ scope: "project", content: "use object params", version: 1 }],
		playbooks: [
			{
				id: "pb1",
				intent: "add a route",
				areaTags: ["backend"],
				commands: ["bun test"],
				gotcha: null,
				diffShape: null,
				validation: "green",
				status: "confirmed",
				confidence: 80,
				score: 0.9,
			},
		],
		indexSlices: [
			{
				path: "a/b.ts",
				areaTags: ["backend"],
				summary: "[backend]",
				score: 0.5,
			},
		],
		estimatedTokens: 42,
		trimmed: false,
	};
	const playbook: MemoryPlaybookDetail = {
		id: "pb1",
		projectId: "proj",
		intent: "add a route",
		touchedPaths: ["a/b.ts"],
		areaTags: ["backend"],
		commands: ["bun test"],
		gotcha: null,
		diffShape: null,
		validation: "green",
		status: "confirmed",
		confidence: 80,
		createdAt: 1,
		updatedAt: 2,
	};
	const practice: MemoryPracticeResult = {
		scope: "project",
		projectId: "proj",
		version: 1,
		content: "use object params",
	};
	return {
		search: async () => search,
		getPlaybook: async () => playbook,
		getPractice: async () => practice,
		...overrides,
	};
}

async function callTool(
	provider: MemoryDataProvider,
	name: string,
	args: Record<string, unknown>,
) {
	const { client, cleanup } = await createInMemoryMemoryMcpClient(provider);
	try {
		const res = await client.callTool({ name, arguments: args });
		return res;
	} finally {
		await cleanup();
	}
}

describe("local memory MCP server (in-memory)", () => {
	it("lists the three memory tools", async () => {
		const { client, cleanup } = await createInMemoryMemoryMcpClient(
			fakeProvider(),
		);
		try {
			const { tools } = await client.listTools();
			const names = tools.map((t) => t.name).sort();
			expect(names).toEqual([
				"memory_get_playbook",
				"memory_get_practice",
				"memory_search",
			]);
		} finally {
			await cleanup();
		}
	});

	it("memory_search returns the retrieval bundle", async () => {
		const res = await callTool(fakeProvider(), "memory_search", {
			intent: "work on the backend",
			projectId: "proj",
		});
		const structured = res.structuredContent as MemorySearchResult;
		expect(structured.playbooks[0]?.id).toBe("pb1");
		expect(structured.practices[0]?.content).toBe("use object params");
		expect(structured.estimatedTokens).toBe(42);
	});

	it("memory_search forwards inputs to the provider", async () => {
		let received: unknown;
		const provider = fakeProvider({
			search: async (input) => {
				received = input;
				return {
					queryAreas: [],
					practices: [],
					playbooks: [],
					indexSlices: [],
					estimatedTokens: 0,
					trimmed: false,
				};
			},
		});
		await callTool(provider, "memory_search", {
			intent: "x",
			projectId: "proj",
			areaTags: ["schema"],
			topKPlaybooks: 3,
		});
		expect(received).toMatchObject({
			intent: "x",
			projectId: "proj",
			areaTags: ["schema"],
			topKPlaybooks: 3,
		});
	});

	it("memory_get_playbook returns a playbook", async () => {
		const res = await callTool(fakeProvider(), "memory_get_playbook", {
			id: "pb1",
		});
		const structured = res.structuredContent as {
			playbook: MemoryPlaybookDetail;
		};
		expect(structured.playbook.id).toBe("pb1");
		expect(structured.playbook.touchedPaths).toEqual(["a/b.ts"]);
	});

	it("memory_get_playbook reports not-found as an error result", async () => {
		const provider = fakeProvider({ getPlaybook: async () => null });
		const res = await callTool(provider, "memory_get_playbook", { id: "nope" });
		expect(res.isError).toBe(true);
	});

	it("memory_get_practice returns the practice doc", async () => {
		const res = await callTool(fakeProvider(), "memory_get_practice", {
			scope: "project",
			projectId: "proj",
		});
		const structured = res.structuredContent as MemoryPracticeResult;
		expect(structured.scope).toBe("project");
		expect(structured.content).toBe("use object params");
	});
});
