import { describe, expect, it } from "bun:test";
import { findPrReviewPane } from "./findPrReviewPane";

type Tab = {
	id: string;
	panes: Record<string, { id: string; kind: string; data: unknown }>;
};

describe("findPrReviewPane", () => {
	it("returns null when no tabs have a pr-review pane", () => {
		const tabs: Tab[] = [
			{ id: "t1", panes: { p1: { id: "p1", kind: "chat", data: {} } } },
			{ id: "t2", panes: { p2: { id: "p2", kind: "terminal", data: {} } } },
		];
		expect(findPrReviewPane(tabs, 12)).toBeNull();
	});

	it("returns the tab+pane id of the window for the matching PR", () => {
		const tabs: Tab[] = [
			{ id: "t1", panes: { p1: { id: "p1", kind: "chat", data: {} } } },
			{
				id: "t2",
				panes: {
					p2: { id: "p2", kind: "file", data: {} },
					p3: {
						id: "p3",
						kind: "pr-review",
						data: { prNumber: 12, section: "diff" },
					},
				},
			},
		];
		expect(findPrReviewPane(tabs, 12)).toEqual({ tabId: "t2", paneId: "p3" });
	});

	it("does NOT match a pr-review pane for a different PR number", () => {
		const tabs: Tab[] = [
			{
				id: "t1",
				panes: {
					p1: {
						id: "p1",
						kind: "pr-review",
						data: { prNumber: 12, section: "diff" },
					},
				},
			},
		];
		expect(findPrReviewPane(tabs, 13)).toBeNull();
	});

	it("returns the first matching window when several windows for the same PR exist", () => {
		const tabs: Tab[] = [
			{
				id: "t1",
				panes: {
					p1: {
						id: "p1",
						kind: "pr-review",
						data: { prNumber: 7, section: "diff" },
					},
				},
			},
			{
				id: "t2",
				panes: {
					p2: {
						id: "p2",
						kind: "pr-review",
						data: { prNumber: 7, section: "guide" },
					},
				},
			},
		];
		expect(findPrReviewPane(tabs, 7)).toEqual({ tabId: "t1", paneId: "p1" });
	});

	it("handles empty input", () => {
		expect(findPrReviewPane([], 1)).toBeNull();
	});
});
