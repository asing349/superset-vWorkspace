import { beforeEach, describe, expect, it } from "bun:test";

// The store uses zustand's `persist` middleware, which writes to localStorage on
// every state change. The headless bun runner has no DOM, so provide a minimal
// in-memory shim before importing the store.
if (typeof globalThis.localStorage === "undefined") {
	const backing = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => backing.get(key) ?? null,
			setItem: (key: string, value: string) => {
				backing.set(key, value);
			},
			removeItem: (key: string) => {
				backing.delete(key);
			},
			clear: () => backing.clear(),
		},
	});
}

const { promptKey, useMemoryCapturePromptStore } = await import("./store");

function resetStore() {
	useMemoryCapturePromptStore.setState({ answeredAt: {} });
}

describe("memory-capture-prompt store", () => {
	beforeEach(resetStore);

	it("builds a stable per-PR key", () => {
		expect(promptKey("proj-1", 42)).toBe("proj-1:42");
	});

	it("is unanswered until marked, then answered (once per PR)", () => {
		const { isAnswered, markAnswered } = useMemoryCapturePromptStore.getState();
		expect(isAnswered("proj-1", 42)).toBe(false);

		markAnswered("proj-1", 42);
		expect(
			useMemoryCapturePromptStore.getState().isAnswered("proj-1", 42),
		).toBe(true);
	});

	it("scopes answered state per project and per PR number", () => {
		const { markAnswered } = useMemoryCapturePromptStore.getState();
		markAnswered("proj-1", 42);

		const { isAnswered } = useMemoryCapturePromptStore.getState();
		// Same PR number, different project → still unanswered.
		expect(isAnswered("proj-2", 42)).toBe(false);
		// Same project, different PR number → still unanswered.
		expect(isAnswered("proj-1", 7)).toBe(false);
	});
});
