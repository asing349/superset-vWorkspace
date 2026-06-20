import { describe, expect, it } from "bun:test";
import type { DetectedPort } from "@superset/port-scanner";
import type { FsWatchEvent } from "@superset/workspace-fs/host";
import type { HostDb } from "../db";
import { portManager } from "../ports/port-manager";
import type { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { EventBus } from "./event-bus";
import type { GitWatcher } from "./git-watcher";

function createEventBus(): EventBus {
	return new EventBus({
		db: {} as unknown as HostDb,
		filesystem: {
			resolveWorkspaceRoot: () => "/tmp/missing-workspace",
		} as unknown as WorkspaceFilesystemManager,
		gitWatcher: {
			onChanged: () => () => {},
		} as unknown as GitWatcher,
	});
}

/**
 * A controllable `watchPath`-shaped async iterable. Tests `push()` event
 * batches and `await`-driven backpressure; `returnCount` records how many
 * times the consumer called `iterator.return()` (the teardown signal) so we
 * can assert no leaked/duplicate watchers.
 */
function createControllableWatcher() {
	const queue: Array<{ events: FsWatchEvent[] }> = [];
	let resolveNext:
		| ((value: IteratorResult<{ events: FsWatchEvent[] }>) => void)
		| null = null;
	let returned = false;
	const state = { returnCount: 0 };

	const iterator: AsyncIterator<{ events: FsWatchEvent[] }> = {
		next() {
			if (queue.length > 0) {
				const value = queue.shift();
				if (value) return Promise.resolve({ value, done: false });
			}
			if (returned) return Promise.resolve({ value: undefined, done: true });
			return new Promise((resolve) => {
				resolveNext = resolve;
			});
		},
		return() {
			state.returnCount += 1;
			returned = true;
			if (resolveNext) {
				resolveNext({ value: undefined, done: true });
				resolveNext = null;
			}
			return Promise.resolve({ value: undefined, done: true });
		},
	};

	return {
		state,
		push(batch: { events: FsWatchEvent[] }) {
			if (resolveNext) {
				resolveNext({ value: batch, done: false });
				resolveNext = null;
			} else {
				queue.push(batch);
			}
		},
		stream: {
			[Symbol.asyncIterator]: () => iterator,
		} as AsyncIterable<{ events: FsWatchEvent[] }>,
	};
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("EventBus port events", () => {
	it("broadcasts port changes from the shared port manager and removes listeners on close", () => {
		const eventBus = createEventBus();
		const sentMessages: string[] = [];
		const socket = {
			readyState: 1,
			send(data: string) {
				sentMessages.push(data);
			},
			close() {},
		};
		const port: DetectedPort = {
			port: 5173,
			pid: 123,
			processName: "vite",
			terminalId: "terminal-1",
			workspaceId: "workspace-1",
			detectedAt: 1_700_000_000_000,
			address: "127.0.0.1",
		};

		eventBus.handleOpen(socket);
		eventBus.start();
		eventBus.start();
		portManager.emit("port:add", port);

		expect(sentMessages).toHaveLength(1);
		const message = JSON.parse(sentMessages[0] ?? "{}");
		expect(message).toMatchObject({
			type: "port:changed",
			workspaceId: "workspace-1",
			eventType: "add",
			port,
			label: null,
		});
		expect(typeof message.occurredAt).toBe("number");

		portManager.emit("port:remove", port);
		expect(sentMessages).toHaveLength(2);
		expect(JSON.parse(sentMessages[1] ?? "{}")).toMatchObject({
			type: "port:changed",
			workspaceId: "workspace-1",
			eventType: "remove",
			port,
			label: null,
		});

		eventBus.close();
		portManager.emit("port:add", port);
		expect(sentMessages).toHaveLength(2);
	});
});

describe("EventBus group-addressed fs watch (Wave-2 M6)", () => {
	const groupId = "group-1";
	const rootId = "root-1";

	function setup() {
		const watcher = createControllableWatcher();
		const watchCalls: Array<{ absolutePath: string; recursive?: boolean }> = [];
		const filesystem = {
			resolveRootPath: () => "/tmp/folder-root",
			getServiceForRootId: () => ({
				watchPath: (input: { absolutePath: string; recursive?: boolean }) => {
					watchCalls.push(input);
					return watcher.stream;
				},
			}),
		} as unknown as WorkspaceFilesystemManager;

		const eventBus = new EventBus({
			db: {} as unknown as HostDb,
			filesystem,
			gitWatcher: { onChanged: () => () => {} } as unknown as GitWatcher,
		});

		const sent: string[] = [];
		const socket = {
			readyState: 1,
			send: (data: string) => sent.push(data),
			close: () => {},
		};

		return { eventBus, socket, sent, watcher, watchCalls };
	}

	it("emits fs:groupEvents with the same events payload, keyed by {groupId, rootId}", async () => {
		const { eventBus, socket, sent, watcher, watchCalls } = setup();
		eventBus.handleOpen(socket);
		eventBus.handleMessage(
			socket,
			JSON.stringify({ type: "fs:watchGroup", groupId, rootId }),
		);

		expect(watchCalls).toEqual([
			{ absolutePath: "/tmp/folder-root", recursive: true },
		]);

		const events: FsWatchEvent[] = [
			{ kind: "update", absolutePath: "/tmp/folder-root/a.txt" },
		];
		watcher.push({ events });
		await flush();

		expect(sent).toHaveLength(1);
		expect(JSON.parse(sent[0] ?? "{}")).toEqual({
			type: "fs:groupEvents",
			groupId,
			rootId,
			events,
		});
	});

	it("is idempotent per client: a second watchGroup does not start a duplicate watcher", () => {
		const { eventBus, socket, watchCalls } = setup();
		eventBus.handleOpen(socket);
		const cmd = JSON.stringify({ type: "fs:watchGroup", groupId, rootId });
		eventBus.handleMessage(socket, cmd);
		eventBus.handleMessage(socket, cmd);
		expect(watchCalls).toHaveLength(1);
	});

	it("tears down the watcher on fs:unwatchGroup (no leak)", async () => {
		const { eventBus, socket, watcher } = setup();
		eventBus.handleOpen(socket);
		eventBus.handleMessage(
			socket,
			JSON.stringify({ type: "fs:watchGroup", groupId, rootId }),
		);
		expect(watcher.state.returnCount).toBe(0);

		eventBus.handleMessage(
			socket,
			JSON.stringify({ type: "fs:unwatchGroup", groupId, rootId }),
		);
		await flush();
		expect(watcher.state.returnCount).toBe(1);
	});

	it("tears down on client close and on bus close (no leak)", async () => {
		const onClose = setup();
		onClose.eventBus.handleOpen(onClose.socket);
		onClose.eventBus.handleMessage(
			onClose.socket,
			JSON.stringify({ type: "fs:watchGroup", groupId, rootId }),
		);
		onClose.eventBus.handleClose(onClose.socket);
		await flush();
		expect(onClose.watcher.state.returnCount).toBe(1);

		const onBusClose = setup();
		onBusClose.eventBus.handleOpen(onBusClose.socket);
		onBusClose.eventBus.handleMessage(
			onBusClose.socket,
			JSON.stringify({ type: "fs:watchGroup", groupId, rootId }),
		);
		onBusClose.eventBus.close();
		await flush();
		expect(onBusClose.watcher.state.returnCount).toBe(1);
	});

	it("surfaces an error message when the root cannot be resolved", () => {
		const eventBus = new EventBus({
			db: {} as unknown as HostDb,
			filesystem: {
				getServiceForRootId: () => {
					throw new Error("Workspace group not found: group-x");
				},
			} as unknown as WorkspaceFilesystemManager,
			gitWatcher: { onChanged: () => () => {} } as unknown as GitWatcher,
		});
		const sent: string[] = [];
		const socket = {
			readyState: 1,
			send: (data: string) => sent.push(data),
			close: () => {},
		};
		eventBus.handleOpen(socket);
		eventBus.handleMessage(
			socket,
			JSON.stringify({ type: "fs:watchGroup", groupId: "group-x", rootId }),
		);
		expect(sent).toHaveLength(1);
		expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({
			type: "error",
			message: "Workspace group not found: group-x",
		});
	});
});
