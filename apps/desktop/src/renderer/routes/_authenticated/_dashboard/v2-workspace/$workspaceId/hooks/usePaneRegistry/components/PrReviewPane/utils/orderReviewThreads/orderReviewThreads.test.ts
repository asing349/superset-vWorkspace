import { describe, expect, it } from "bun:test";
import { orderReviewThreads } from "./orderReviewThreads";

/**
 * Wave-6 M4: the Threads-tab ordering helper. Unresolved-current first, then
 * unresolved-outdated, then resolved-current, then resolved-outdated; stable
 * within each bucket. Pure browser-safe logic (no DOM render infra in the
 * desktop renderer — covered as a pure helper, the M3 pattern).
 */

interface Thread {
	id: string;
	isResolved: boolean;
	isOutdated: boolean;
}

const t = (id: string, isResolved: boolean, isOutdated: boolean): Thread => ({
	id,
	isResolved,
	isOutdated,
});

describe("orderReviewThreads", () => {
	it("puts unresolved threads ahead of resolved ones", () => {
		const ordered = orderReviewThreads([
			t("resolved", true, false),
			t("open", false, false),
		]);
		expect(ordered.map((x) => x.id)).toEqual(["open", "resolved"]);
	});

	it("orders by the full rank: open-current, open-outdated, resolved-current, resolved-outdated", () => {
		const ordered = orderReviewThreads([
			t("resolved-outdated", true, true),
			t("resolved-current", true, false),
			t("open-outdated", false, true),
			t("open-current", false, false),
		]);
		expect(ordered.map((x) => x.id)).toEqual([
			"open-current",
			"open-outdated",
			"resolved-current",
			"resolved-outdated",
		]);
	});

	it("is stable within a bucket (preserves GitHub's order)", () => {
		const ordered = orderReviewThreads([
			t("a", false, false),
			t("b", false, false),
			t("c", false, false),
		]);
		expect(ordered.map((x) => x.id)).toEqual(["a", "b", "c"]);
	});

	it("does not mutate the input array", () => {
		const input = [t("resolved", true, false), t("open", false, false)];
		const snapshot = input.map((x) => x.id);
		orderReviewThreads(input);
		expect(input.map((x) => x.id)).toEqual(snapshot);
	});

	it("returns an empty array unchanged", () => {
		expect(orderReviewThreads([])).toEqual([]);
	});
});
