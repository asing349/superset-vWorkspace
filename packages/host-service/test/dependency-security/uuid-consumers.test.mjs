import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const store = new URL("../../../../node_modules/.bun/", import.meta.url)
	.pathname;
const sharedRequire = createRequire(join(store, "node_modules/package.json"));

test("Mosaic creates UUID v4 ids and preserves explicitly supplied ids", () => {
	const mosaicRequire = createRequire(
		sharedRequire.resolve("react-mosaic-component"),
	);
	const { MosaicWithoutDragDropContext } = mosaicRequire("./Mosaic.js");
	const props = {
		renderTile: () => null,
		onChange: () => {},
		onRelease: () => {},
	};
	const generated = new MosaicWithoutDragDropContext(props);
	assert.match(
		generated.state.mosaicId,
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
	);
	const explicit = new MosaicWithoutDragDropContext({
		...props,
		mosaicId: "user-selected",
	});
	assert.equal(explicit.state.mosaicId, "user-selected");
});

for (const entry of readdirSync(store).filter((entry) =>
	/^xcode@\d/.test(entry),
)) {
	test(`${entry} retains unique Xcode project identifiers`, () => {
		const xcodeRequire = createRequire(
			join(store, entry, "node_modules/xcode/package.json"),
		);
		const xcode = xcodeRequire("./index.js");
		const project = xcode.project("/unused-fixture.pbxproj");
		project.hash = { project: { objects: {} } };
		const ids = new Set();
		for (let index = 0; index < 100; index++) {
			const id = project.generateUuid();
			assert.match(id, /^[A-F0-9]{24}$/);
			assert.ok(!ids.has(id));
			ids.add(id);
		}
	});
}
