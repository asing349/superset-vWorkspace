import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

type Merge = {
	(
		target: object,
		source: object,
		options?: Record<string, unknown>,
	): Record<PropertyKey, unknown>;
	all: (objects: object[]) => Record<PropertyKey, unknown>;
};
const require = createRequire(
	new URL(
		"../../../../node_modules/.bun/node_modules/package.json",
		import.meta.url,
	),
);
const main = require.resolve("deepmerge");
const implementations: [string, Merge][] = [
	["CommonJS", require("deepmerge") as Merge],
	["browser UMD", require(join(dirname(main), "umd.js")) as Merge],
];
const malicious = () => JSON.parse('{"__proto__":{"isAdmin":true}}') as object;

for (const [name, merge] of implementations) {
	describe(`${name} merge prototype containment`, () => {
		test("does not poison a result from a null-prototype target", () => {
			const result = merge(Object.create(null), malicious());
			expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
			expect(result.isAdmin).toBeUndefined();
			expect(Object.hasOwn(result, "__proto__")).toBe(false);
		});
		test("does not poison a nested null placeholder", () => {
			const result = merge({ session: null }, { session: malicious() });
			expect(Object.getPrototypeOf(result.session)).toBe(Object.prototype);
			expect(
				(result.session as Record<string, unknown>).isAdmin,
			).toBeUndefined();
		});
		test("does not copy a dangerous target key before checking the source", () => {
			const result = merge(malicious(), { normal: true });
			expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
			expect(result.isAdmin).toBeUndefined();
			expect(result.normal).toBe(true);
		});
		test("preserves ordinary nested merging and array concatenation", () => {
			expect(
				merge({ nested: { a: 1 }, list: [1] }, { nested: { b: 2 }, list: [2] }),
			).toEqual({ nested: { a: 1, b: 2 }, list: [1, 2] });
		});
		test("preserves custom array merging and source immutability", () => {
			const source = { list: [2] };
			expect(
				merge({ list: [1] }, source, {
					arrayMerge: (_target: unknown[], value: unknown[]) => value,
				}),
			).toEqual({ list: [2] });
			expect(source).toEqual({ list: [2] });
		});
		test("preserves enumerable symbols and legitimate existing data keys", () => {
			const key = Symbol("metadata");
			const result = merge(
				{ [key]: { a: 1 }, constructor: { a: 1 } },
				{ [key]: { b: 2 }, constructor: { b: 2 } },
			);
			expect(result[key]).toEqual({ a: 1, b: 2 });
			expect(result.constructor).toEqual({ a: 1, b: 2 });
			expect(merge.all([{ first: true }, { second: true }])).toEqual({
				first: true,
				second: true,
			});
		});
	});
}
