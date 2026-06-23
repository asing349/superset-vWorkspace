import { describe, expect, it } from "bun:test";
import { findMemoryPane } from "./findMemoryPane";

type Tab = { id: string; panes: Record<string, { id: string; kind: string }> };

describe("findMemoryPane", () => {
	it("returns null when no tabs have a memory pane", () => {
		const tabs: Tab[] = [
			{ id: "t1", panes: { p1: { id: "p1", kind: "chat" } } },
			{ id: "t2", panes: { p2: { id: "p2", kind: "terminal" } } },
		];
		expect(findMemoryPane(tabs)).toBeNull();
	});

	it("returns the tab+pane id of an existing memory pane", () => {
		const tabs: Tab[] = [
			{ id: "t1", panes: { p1: { id: "p1", kind: "chat" } } },
			{
				id: "t2",
				panes: {
					p2: { id: "p2", kind: "file" },
					p3: { id: "p3", kind: "memory" },
				},
			},
		];
		expect(findMemoryPane(tabs)).toEqual({ tabId: "t2", paneId: "p3" });
	});

	it("returns the first memory pane when several exist", () => {
		const tabs: Tab[] = [
			{ id: "t1", panes: { p1: { id: "p1", kind: "memory" } } },
			{ id: "t2", panes: { p2: { id: "p2", kind: "memory" } } },
		];
		expect(findMemoryPane(tabs)).toEqual({ tabId: "t1", paneId: "p1" });
	});

	it("handles empty input", () => {
		expect(findMemoryPane([])).toBeNull();
	});
});
