import { describe, expect, it } from "bun:test";
import { resolveScrollTarget, scrollRequestKey } from "./resolveScrollTarget";

const itemIdByFile = new Map<string, string>([
	["src/foo.ts", "pr-diff:1:src/foo.ts"],
	// a rename: both the new and previous name map to the same item
	["src/new.ts", "pr-diff:1:src/new.ts"],
	["src/old.ts", "pr-diff:1:src/new.ts"],
]);
const renderableItemIds = new Set<string>([
	"pr-diff:1:src/foo.ts",
	"pr-diff:1:src/new.ts",
]);

describe("resolveScrollTarget", () => {
	it("returns a centered line target when a line is given", () => {
		const target = resolveScrollTarget({
			focusFile: "src/foo.ts",
			focusLine: 42,
			itemIdByFile,
			renderableItemIds,
		});
		expect(target).toEqual({
			type: "line",
			id: "pr-diff:1:src/foo.ts",
			lineNumber: 42,
			align: "center",
			behavior: "smooth-auto",
		});
	});

	it("returns a file (item) target when no line is given", () => {
		const target = resolveScrollTarget({
			focusFile: "src/foo.ts",
			focusLine: undefined,
			itemIdByFile,
			renderableItemIds,
		});
		expect(target).toEqual({
			type: "item",
			id: "pr-diff:1:src/foo.ts",
			align: "start",
			behavior: "smooth-auto",
		});
	});

	it("resolves a rename anchor by its previous filename", () => {
		const target = resolveScrollTarget({
			focusFile: "src/old.ts",
			focusLine: 3,
			itemIdByFile,
			renderableItemIds,
		});
		// line/item targets both carry `id`; the position target (no id) is never
		// produced by resolveScrollTarget.
		expect(target).not.toBeNull();
		expect(target && "id" in target ? target.id : null).toBe(
			"pr-diff:1:src/new.ts",
		);
	});

	it("returns null when there is no focusFile", () => {
		expect(
			resolveScrollTarget({
				focusFile: undefined,
				focusLine: 1,
				itemIdByFile,
				renderableItemIds,
			}),
		).toBeNull();
	});

	it("returns null for a file with no renderable item (binary / not in PR)", () => {
		expect(
			resolveScrollTarget({
				focusFile: "assets/logo.png",
				focusLine: undefined,
				itemIdByFile,
				renderableItemIds,
			}),
		).toBeNull();
	});

	it("returns null when the file maps to an item that isn't currently rendered", () => {
		// itemIdByFile knows the file, but it's not in the rendered set.
		expect(
			resolveScrollTarget({
				focusFile: "src/foo.ts",
				focusLine: 1,
				itemIdByFile,
				renderableItemIds: new Set(),
			}),
		).toBeNull();
	});
});

describe("scrollRequestKey", () => {
	it("changes when focusTick bumps (repeat click of the same anchor)", () => {
		const base = {
			focusFile: "src/foo.ts",
			focusLine: 10,
			itemIdByFile,
			renderableItemIds,
		};
		const k1 = scrollRequestKey({ ...base, focusTick: 100 });
		const k2 = scrollRequestKey({ ...base, focusTick: 200 });
		expect(k1).not.toBeNull();
		expect(k1).not.toBe(k2);
	});

	it("is stable for the same file+line+tick", () => {
		const args = {
			focusFile: "src/foo.ts",
			focusLine: 10,
			focusTick: 100,
			itemIdByFile,
			renderableItemIds,
		};
		expect(scrollRequestKey(args)).toBe(scrollRequestKey(args));
	});

	it("returns null when nothing resolves", () => {
		expect(
			scrollRequestKey({
				focusFile: undefined,
				focusLine: undefined,
				focusTick: 1,
				itemIdByFile,
				renderableItemIds,
			}),
		).toBeNull();
	});
});
