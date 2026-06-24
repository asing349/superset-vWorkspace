import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db/index.ts";
import * as schema from "../../db/schema";
import { projects, workspaces } from "../../db/schema";
import type { ChatRuntimeManager } from "../chat/index.ts";
import { createLocalAiSession } from "./local-ai-session.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

/**
 * Build a mock ChatRuntimeManager exposing only the methods the bridge drives:
 * sendMessage, getSnapshot, stop, disposeRuntime. `snapshots` is a queue of the
 * display-state/messages each successive getSnapshot returns.
 */
function mockChat(opts: {
	snapshots?: Array<{ displayState: unknown; messages: unknown }>;
	getSnapshotThrows?: boolean;
	sendThrows?: boolean;
	onStop?: () => void;
	onDispose?: () => void;
	onApproval?: () => void;
	onQuestion?: () => void;
}): ChatRuntimeManager {
	let i = 0;
	const queue = opts.snapshots ?? [];
	const manager = {
		sendMessage: async () => {
			if (opts.sendThrows)
				throw new Error("No model provider credentials available");
			return undefined;
		},
		getSnapshot: async () => {
			if (opts.getSnapshotThrows) throw new Error("snapshot boom");
			const next = queue[Math.min(i, queue.length - 1)];
			i += 1;
			return next ?? { displayState: {}, messages: [] };
		},
		stop: async () => {
			opts.onStop?.();
		},
		disposeRuntime: async () => {
			opts.onDispose?.();
		},
		respondToApproval: async () => {
			opts.onApproval?.();
		},
		respondToQuestion: async () => {
			opts.onQuestion?.();
		},
	};
	return manager as unknown as ChatRuntimeManager;
}

function assistantSnapshot(text: string) {
	return {
		displayState: { isRunning: false, currentMessage: null },
		messages: [
			{ role: "user", content: [{ type: "text", text: "prompt" }] },
			{ role: "assistant", content: [{ type: "text", text }] },
		],
	};
}

describe("createLocalAiSession — availability", () => {
	let db: HostDb;
	beforeEach(() => {
		db = buildDb();
	});
	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("returns null when the project has no workspace", () => {
		const session = createLocalAiSession({
			db,
			chat: mockChat({}),
			projectId: "no-such-project",
		});
		expect(session).toBeNull();
	});

	it("returns a session when a workspace exists for the project", () => {
		db.insert(projects).values({ id: "proj-1", repoPath: "/tmp/r" }).run();
		db.insert(workspaces)
			.values({
				id: "ws-1",
				projectId: "proj-1",
				worktreePath: "/tmp/r/ws-1",
				branch: "feature",
			})
			.run();
		const session = createLocalAiSession({
			db,
			chat: mockChat({}),
			projectId: "proj-1",
		});
		expect(session).not.toBeNull();
		expect(session?.isAvailable()).toBe(true);
	});
});

describe("createLocalAiSession — complete drives the one-shot safely", () => {
	let db: HostDb;
	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: "proj-1", repoPath: "/tmp/r" }).run();
		db.insert(workspaces)
			.values({
				id: "ws-1",
				projectId: "proj-1",
				worktreePath: "/tmp/r/ws-1",
				branch: "feature",
			})
			.run();
	});
	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function makeSession(chat: ChatRuntimeManager) {
		const session = createLocalAiSession({ db, chat, projectId: "proj-1" });
		if (!session) throw new Error("expected a session");
		return session;
	}

	it("returns the assistant text on a settled reply", async () => {
		let disposed = false;
		const chat = mockChat({
			snapshots: [
				{
					displayState: { isRunning: true, currentMessage: {} },
					messages: [],
				},
				assistantSnapshot('{"overview":"hi"}'),
			],
			onDispose: () => {
				disposed = true;
			},
		});
		const out = await makeSession(chat).complete({ prompt: "analyze" });
		expect(out).toBe('{"overview":"hi"}');
		// Always tears the transient session down.
		expect(disposed).toBe(true);
	});

	it("returns null and never auto-approves when the run is human-blocked", async () => {
		let approved = false;
		let answered = false;
		let disposed = false;
		const chat = mockChat({
			snapshots: [
				{
					displayState: {
						isRunning: true,
						currentMessage: {},
						pendingApproval: { toolCallId: "t1", toolName: "write" },
					},
					messages: [],
				},
			],
			onApproval: () => {
				approved = true;
			},
			onQuestion: () => {
				answered = true;
			},
			onDispose: () => {
				disposed = true;
			},
		});
		const out = await makeSession(chat).complete({ prompt: "analyze" });
		expect(out).toBeNull();
		// HARD SAFETY: we decline-by-stopping, never auto-approve / auto-answer.
		expect(approved).toBe(false);
		expect(answered).toBe(false);
		expect(disposed).toBe(true);
	});

	it("returns null (no throw) when sendMessage throws (e.g. no provider)", async () => {
		let disposed = false;
		const chat = mockChat({
			sendThrows: true,
			onDispose: () => {
				disposed = true;
			},
		});
		const out = await makeSession(chat).complete({ prompt: "analyze" });
		expect(out).toBeNull();
		expect(disposed).toBe(true);
	});

	it("returns null (no throw) when getSnapshot throws", async () => {
		const chat = mockChat({ getSnapshotThrows: true });
		const out = await makeSession(chat).complete({ prompt: "analyze" });
		expect(out).toBeNull();
	});

	it("returns null when the assistant message has no text", async () => {
		const chat = mockChat({
			snapshots: [
				{
					displayState: { isRunning: false, currentMessage: null },
					messages: [{ role: "assistant", content: [] }],
				},
			],
		});
		const out = await makeSession(chat).complete({ prompt: "analyze" });
		expect(out).toBeNull();
	});

	it("short-circuits to null when the abort signal is already aborted", async () => {
		let disposed = false;
		// If the drive started, getSnapshot would throw and we'd still get null —
		// so we assert teardown was NOT reached, proving we never spun a session.
		const chat = mockChat({
			getSnapshotThrows: true,
			onDispose: () => {
				disposed = true;
			},
		});
		const controller = new AbortController();
		controller.abort();
		const out = await makeSession(chat).complete({
			prompt: "analyze",
			signal: controller.signal,
		});
		expect(out).toBeNull();
		expect(disposed).toBe(false);
	});
});
