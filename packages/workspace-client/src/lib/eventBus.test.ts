import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	ClientMessage,
	ServerMessage,
} from "@superset/host-service/events";
import type { FsWatchEvent } from "@superset/workspace-fs/host";
import { getEventBus } from "./eventBus";

/**
 * Minimal WebSocket double for the event-bus tests. The real `getEventBus`
 * opens a `WebSocket` (via `getOrCreateConnection` → `connect`), so we stub the
 * global. Each instance registers itself in `openSockets` so a test can drive
 * `onopen`/`onmessage`/`onclose` and inspect the `ClientMessage`s the bus sent.
 *
 * Note: `connect()` first awaits `primeRelayAffinity(wsUrl)`. That helper only
 * issues a `fetch` for `/hosts/<id>/*` URLs and otherwise resolves immediately
 * with no network call — so every test uses a NON-`/hosts/` host URL, the
 * affinity probe is a no-op, and the socket is created on the next microtask.
 */
class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	sentMessages: ClientMessage[] = [];
	closeCalls: Array<{ code?: number; reason?: string }> = [];

	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(public readonly url: string) {
		openSockets.push(this);
	}

	send(data: string): void {
		this.sentMessages.push(JSON.parse(data) as ClientMessage);
	}

	close(code?: number, reason?: string): void {
		this.closeCalls.push({ code, reason });
		this.readyState = MockWebSocket.CLOSED;
	}

	/** Simulate the server accepting the connection. */
	open(): void {
		this.readyState = MockWebSocket.OPEN;
		this.onopen?.();
	}

	/** Deliver a server message to the bus. */
	receive(message: ServerMessage): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	/** Simulate the socket dropping (server bounce / network blip). */
	drop(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	}
}

let openSockets: MockWebSocket[] = [];
let originalWebSocket: typeof globalThis.WebSocket | undefined;
let hostCounter = 0;

/** A fresh, non-`/hosts/` host URL per test so each gets its own connection. */
function uniqueHostUrl(): string {
	hostCounter += 1;
	return `http://127.0.0.1:9${hostCounter.toString().padStart(3, "0")}`;
}

const noToken = () => null;

/** Flush microtasks so `connect`'s `primeRelayAffinity().then()` runs. */
async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

/** Spin up a bus + its (now-open) socket, returning both. */
async function openBus() {
	const hostUrl = uniqueHostUrl();
	const bus = getEventBus(hostUrl, noToken);
	await flushMicrotasks();
	const socket = openSockets.at(-1);
	if (!socket) throw new Error("expected a socket to be created");
	socket.open();
	return { hostUrl, bus, socket };
}

function makeFsEvent(absolutePath: string): FsWatchEvent {
	return {
		kind: "update",
		absolutePath,
		isDirectory: false,
	} as FsWatchEvent;
}

beforeEach(() => {
	openSockets = [];
	originalWebSocket = globalThis.WebSocket;
	(globalThis as { WebSocket: unknown }).WebSocket =
		MockWebSocket as unknown as typeof globalThis.WebSocket;
});

afterEach(() => {
	if (originalWebSocket) {
		(globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
	}
});

describe("watchFsGroup / unwatchFsGroup ref-counting", () => {
	it("sends fs:watchGroup once for repeated watches and fs:unwatchGroup only on the last release", async () => {
		const { bus, socket } = await openBus();
		const address = { groupId: "g1", rootId: "r1" };

		bus.watchFsGroup(address);
		bus.watchFsGroup(address);
		bus.watchFsGroup(address);

		const watchCommands = socket.sentMessages.filter(
			(m) => m.type === "fs:watchGroup",
		);
		expect(watchCommands).toHaveLength(1);
		expect(watchCommands[0]).toEqual({
			type: "fs:watchGroup",
			groupId: "g1",
			rootId: "r1",
		});

		bus.unwatchFsGroup(address);
		bus.unwatchFsGroup(address);
		expect(
			socket.sentMessages.filter((m) => m.type === "fs:unwatchGroup"),
		).toHaveLength(0);

		bus.unwatchFsGroup(address);
		expect(
			socket.sentMessages.filter((m) => m.type === "fs:unwatchGroup"),
		).toEqual([{ type: "fs:unwatchGroup", groupId: "g1", rootId: "r1" }]);
	});

	it("ref-counts each {groupId,rootId} independently", async () => {
		const { bus, socket } = await openBus();

		bus.watchFsGroup({ groupId: "g1", rootId: "r1" });
		bus.watchFsGroup({ groupId: "g1", rootId: "r2" });

		const watchCommands = socket.sentMessages.filter(
			(m) => m.type === "fs:watchGroup",
		);
		expect(watchCommands).toHaveLength(2);
		expect(watchCommands).toContainEqual({
			type: "fs:watchGroup",
			groupId: "g1",
			rootId: "r1",
		});
		expect(watchCommands).toContainEqual({
			type: "fs:watchGroup",
			groupId: "g1",
			rootId: "r2",
		});
	});
});

describe("onFsGroup dispatch for fs:groupEvents", () => {
	it("delivers only events matching the listener's {groupId,rootId}", async () => {
		const { bus, socket } = await openBus();
		const received: Array<{
			address: { groupId: string; rootId: string };
			paths: string[];
		}> = [];

		const unsubscribe = bus.onFsGroup(
			{ groupId: "g1", rootId: "r1" },
			(address, payload) => {
				received.push({
					address,
					paths: payload.events.map((e) => e.absolutePath),
				});
			},
		);

		// Matching message → delivered.
		socket.receive({
			type: "fs:groupEvents",
			groupId: "g1",
			rootId: "r1",
			events: [makeFsEvent("/root/a.txt")],
		});
		// Wrong rootId → ignored.
		socket.receive({
			type: "fs:groupEvents",
			groupId: "g1",
			rootId: "r2",
			events: [makeFsEvent("/root/b.txt")],
		});
		// Wrong groupId → ignored.
		socket.receive({
			type: "fs:groupEvents",
			groupId: "g2",
			rootId: "r1",
			events: [makeFsEvent("/root/c.txt")],
		});

		expect(received).toEqual([
			{ address: { groupId: "g1", rootId: "r1" }, paths: ["/root/a.txt"] },
		]);

		unsubscribe();
		socket.receive({
			type: "fs:groupEvents",
			groupId: "g1",
			rootId: "r1",
			events: [makeFsEvent("/root/d.txt")],
		});
		// No further deliveries after unsubscribe.
		expect(received).toHaveLength(1);
	});
});

describe("maybeCleanupConnection widening (group-fs listener keeps it alive)", () => {
	it("does NOT tear down a connection kept alive solely by a group-fs listener", async () => {
		const { bus, socket } = await openBus();

		// A retain() handle that we immediately release, plus a group listener.
		const release = bus.retain();
		const unsubscribe = bus.onFsGroup(
			{ groupId: "g1", rootId: "r1" },
			() => {},
		);

		// Releasing the only refCount must NOT close the socket: the group
		// listener still keeps it alive (the wave-2 widening of the cleanup guard).
		release();
		expect(socket.closeCalls).toHaveLength(0);
		expect(socket.readyState).toBe(MockWebSocket.OPEN);

		// Dropping the last group listener now allows teardown.
		unsubscribe();
		expect(socket.closeCalls).toHaveLength(1);
		expect(socket.closeCalls[0]?.code).toBe(1000);
	});

	it("keeps the connection alive while a workspace listener remains (unchanged)", async () => {
		const { bus, socket } = await openBus();

		const release = bus.retain();
		const unsubscribe = bus.on("fs:events", "ws1", () => {});

		release();
		expect(socket.closeCalls).toHaveLength(0);

		unsubscribe();
		expect(socket.closeCalls).toHaveLength(1);
	});
});

describe("reconnect re-send of group watches", () => {
	it("re-sends active group AND workspace watches on reconnect", async () => {
		const { bus, socket } = await openBus();

		bus.watchFs("ws1");
		bus.watchFsGroup({ groupId: "g1", rootId: "r1" });
		bus.watchFsGroup({ groupId: "g1", rootId: "r2" });

		// Drop the socket: `onclose` nulls `state.socket` and schedules a reconnect
		// (real 1s backoff). The active watch sets live on the connection state, so
		// the reconnect's `onopen` must replay every fs:watch / fs:watchGroup.
		socket.drop();

		// Wait out the first backoff (1s) for `connect()` to fire, then flush the
		// microtask that `primeRelayAffinity().then()` defers the socket creation by.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		await flushMicrotasks();

		const reconnectSocket = openSockets.at(-1);
		if (!reconnectSocket || reconnectSocket === socket) {
			throw new Error("expected a freshly-created reconnect socket");
		}
		reconnectSocket.open();

		const watchTypes = reconnectSocket.sentMessages.map((m) => m.type).sort();
		expect(watchTypes).toEqual(["fs:watch", "fs:watchGroup", "fs:watchGroup"]);
		expect(
			reconnectSocket.sentMessages.filter((m) => m.type === "fs:watchGroup"),
		).toContainEqual({ type: "fs:watchGroup", groupId: "g1", rootId: "r1" });
		expect(
			reconnectSocket.sentMessages.filter((m) => m.type === "fs:watchGroup"),
		).toContainEqual({ type: "fs:watchGroup", groupId: "g1", rootId: "r2" });
		expect(
			reconnectSocket.sentMessages.filter((m) => m.type === "fs:watch"),
		).toContainEqual({ type: "fs:watch", workspaceId: "ws1" });
	}, 5000);
});

describe("existing workspace methods/dispatch are unchanged", () => {
	it("ref-counts watchFs and dispatches fs:events / git:changed by workspaceId", async () => {
		const { bus, socket } = await openBus();

		bus.watchFs("ws1");
		bus.watchFs("ws1");
		expect(
			socket.sentMessages.filter((m) => m.type === "fs:watch"),
		).toHaveLength(1);
		bus.unwatchFs("ws1");
		expect(
			socket.sentMessages.filter((m) => m.type === "fs:unwatch"),
		).toHaveLength(0);
		bus.unwatchFs("ws1");
		expect(socket.sentMessages.filter((m) => m.type === "fs:unwatch")).toEqual([
			{ type: "fs:unwatch", workspaceId: "ws1" },
		]);

		const fsHits: string[] = [];
		const gitHits: Array<string[] | undefined> = [];
		bus.on("fs:events", "ws1", (_workspaceId, payload) => {
			fsHits.push(...payload.events.map((e) => e.absolutePath));
		});
		bus.on("git:changed", "ws1", (_workspaceId, payload) => {
			gitHits.push(payload.paths);
		});

		socket.receive({
			type: "fs:events",
			workspaceId: "ws1",
			events: [makeFsEvent("/ws/a.txt")],
		});
		// Different workspace → filtered out for the ws1 listener.
		socket.receive({
			type: "fs:events",
			workspaceId: "ws2",
			events: [makeFsEvent("/ws/b.txt")],
		});
		socket.receive({
			type: "git:changed",
			workspaceId: "ws1",
			paths: ["src/x.ts"],
		});

		expect(fsHits).toEqual(["/ws/a.txt"]);
		expect(gitHits).toEqual([["src/x.ts"]]);
	});

	it("delivers to a wildcard workspace listener", async () => {
		const { bus, socket } = await openBus();
		const hits: string[] = [];
		bus.on("fs:events", "*", (workspaceId) => {
			hits.push(workspaceId);
		});

		socket.receive({
			type: "fs:events",
			workspaceId: "ws1",
			events: [makeFsEvent("/ws/a.txt")],
		});
		socket.receive({
			type: "fs:events",
			workspaceId: "ws2",
			events: [makeFsEvent("/ws/b.txt")],
		});

		expect(hits).toEqual(["ws1", "ws2"]);
	});

	it("does not deliver group events to workspace listeners (or vice versa)", async () => {
		const { bus, socket } = await openBus();
		const wsHits: string[] = [];
		const groupHits: string[] = [];
		bus.on("fs:events", "*", (workspaceId) => wsHits.push(workspaceId));
		bus.onFsGroup({ groupId: "g1", rootId: "r1" }, (address) =>
			groupHits.push(`${address.groupId}/${address.rootId}`),
		);

		socket.receive({
			type: "fs:groupEvents",
			groupId: "g1",
			rootId: "r1",
			events: [makeFsEvent("/root/a.txt")],
		});
		socket.receive({
			type: "fs:events",
			workspaceId: "ws1",
			events: [makeFsEvent("/ws/a.txt")],
		});

		expect(wsHits).toEqual(["ws1"]);
		expect(groupHits).toEqual(["g1/r1"]);
	});
});
