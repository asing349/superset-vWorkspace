/**
 * Local memory MCP server — provider contract (B4).
 *
 * The memory MCP server is LOCAL and EGRESS-FREE: it does NOT touch the cloud
 * Postgres db or the network. Instead the host (host-service) injects a
 * `MemoryDataProvider` backed by the local host SQLite memory tables. The tools
 * call only this provider, so `@superset/mcp` stays free of any host-only deps
 * and the server can be driven entirely in-memory in tests.
 */

export interface MemorySearchInput {
	projectId?: string | null;
	intent: string;
	areaTags?: string[];
	topKPlaybooks?: number;
	topKIndexSlices?: number;
	maxTokens?: number;
	includeProvisional?: boolean;
}

export interface MemorySearchPlaybook {
	id: string;
	intent: string;
	areaTags: string[];
	commands: string[];
	gotcha: string | null;
	diffShape: string | null;
	validation: string | null;
	status: string;
	confidence: number;
	score: number;
}

export interface MemorySearchIndexSlice {
	path: string;
	areaTags: string[];
	summary: string | null;
	score: number;
}

export interface MemorySearchPractice {
	scope: string;
	content: string;
	version: number | null;
}

export interface MemorySearchResult {
	queryAreas: string[];
	practices: MemorySearchPractice[];
	playbooks: MemorySearchPlaybook[];
	indexSlices: MemorySearchIndexSlice[];
	estimatedTokens: number;
	trimmed: boolean;
}

export interface MemoryPlaybookDetail {
	id: string;
	projectId: string | null;
	intent: string;
	touchedPaths: string[];
	areaTags: string[];
	commands: string[];
	gotcha: string | null;
	diffShape: string | null;
	validation: string | null;
	status: string;
	confidence: number;
	createdAt: number;
	updatedAt: number;
}

export interface MemoryPracticeResult {
	scope: string;
	projectId: string | null;
	version: number | null;
	content: string | null;
}

/**
 * The data source the memory MCP tools read from. Implemented by host-service
 * over its local SQLite memory tables; a test supplies a fake. Methods are
 * async so a host implementation may do I/O, but must NOT make network calls.
 */
export interface MemoryDataProvider {
	search(input: MemorySearchInput): Promise<MemorySearchResult>;
	getPlaybook(input: { id: string }): Promise<MemoryPlaybookDetail | null>;
	getPractice(input: {
		scope: "project" | "global";
		projectId?: string | null;
	}): Promise<MemoryPracticeResult>;
}
