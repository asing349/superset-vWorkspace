import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const store = new URL("../../../../node_modules/.bun/", import.meta.url)
	.pathname;
const require = createRequire(import.meta.url);
for (const version of ["3.25.76", "4.6.7"]) {
	for (const format of ["cjs", "esm"]) {
		const entry = join(
			store,
			`zod@${version}/node_modules/zod/v3/index.${format === "cjs" ? "cjs" : "js"}`,
		);
		const { z } =
			format === "cjs"
				? require(entry)
				: await import(pathToFileURL(entry).href);
		test(`Zod ${version} v3 ${format} enforces upper bounds before children`, async (t) => {
			await t.test(
				"max array rejects before allocating per-element issues",
				() => {
					let calls = 0;
					const child = z.preprocess((value) => {
						calls++;
						return value;
					}, z.string());
					const result = z
						.array(child)
						.max(2, "upper-bound")
						.safeParse(Array(2000).fill(0));
					assert.equal(result.success, false);
					assert.equal(calls, 0);
					assert.equal(result.error.issues.length, 1);
					assert.equal(result.error.issues[0].code, "too_big");
					assert.equal(result.error.issues[0].message, "upper-bound");
				},
			);
			await t.test(
				"exact array length rejects oversized input before children",
				() => {
					let calls = 0;
					const result = z
						.array(
							z.preprocess((value) => {
								calls++;
								return value;
							}, z.string()),
						)
						.length(2)
						.safeParse(["a", "b", "c"]);
					assert.equal(result.success, false);
					assert.equal(calls, 0);
					assert.equal(result.error.issues[0].exact, true);
					assert.equal(result.error.issues[0].maximum, 2);
				},
			);
			await t.test("set upper bounds reject before children", () => {
				let calls = 0;
				const result = z
					.set(
						z.preprocess((value) => {
							calls++;
							return value;
						}, z.number()),
					)
					.max(2)
					.safeParse(new Set([1, 2, 3]));
				assert.equal(result.success, false);
				assert.equal(calls, 0);
				assert.equal(result.error.issues[0].type, "set");
			});
			await t.test(
				"async oversized arrays do not dispatch child work",
				async () => {
					let calls = 0;
					const child = z.preprocess(async (value) => {
						calls++;
						return value;
					}, z.string());
					const result = await z
						.array(child)
						.max(2)
						.safeParseAsync(Array(20).fill("a"));
					assert.equal(result.success, false);
					assert.equal(calls, 0);
				},
			);
			await t.test(
				"async exact-size sets do not dispatch child work",
				async () => {
					let calls = 0;
					const child = z.preprocess(async (value) => {
						calls++;
						return value;
					}, z.string());
					const result = await z
						.set(child)
						.size(2)
						.safeParseAsync(new Set(["a", "b", "c"]));
					assert.equal(result.success, false);
					assert.equal(calls, 0);
				},
			);
			await t.test("valid coercion and transforms are preserved", () => {
				assert.equal(
					z
						.array(z.coerce.number())
						.max(2)
						.transform((items) => items.reduce((a, b) => a + b, 0))
						.parse(["1", "2"]),
					3,
				);
				assert.deepEqual(
					z.array(z.string()).max(1).default(["a"]).parse(undefined),
					["a"],
				);
				assert.deepEqual(
					[...z.map(z.string(), z.number()).parse(new Map([["a", 1]]))],
					[["a", 1]],
				);
			});
			await t.test(
				"error paths/messages and catch fallback are preserved",
				() => {
					const result = z
						.object({ values: z.array(z.string()).max(1, "limit") })
						.safeParse({ values: ["a", "b"] });
					assert.equal(result.success, false);
					assert.deepEqual(result.error.issues[0].path, ["values"]);
					assert.equal(result.error.issues[0].message, "limit");
					assert.deepEqual(
						z.array(z.string()).max(1).catch(["fallback"]).parse(["a", "b"]),
						["fallback"],
					);
				},
			);
			await t.test(
				"small inputs still report element and minimum errors",
				() => {
					const result = z.array(z.string()).min(3).safeParse([0]);
					assert.equal(result.success, false);
					assert.deepEqual(
						result.error.issues.map((issue) => issue.code),
						["too_small", "invalid_type"],
					);
				},
			);
			await t.test(
				"unbounded schemas retain full-error semantics, not a global budget",
				() => {
					const result = z.array(z.string()).safeParse([1, 2]);
					assert.equal(result.success, false);
					assert.equal(result.error.issues.length, 2);
				},
			);
		});
	}
}
const sharedRequire = createRequire(join(store, "node_modules/package.json"));
test("legacy JSON-schema adapter retains valid maxItems behavior", () => {
	const { convertJsonSchemaToZod } = sharedRequire("zod-from-json-schema-v3");
	const schema = convertJsonSchemaToZod({
		type: "array",
		items: { type: "string" },
		maxItems: 1,
	});
	assert.deepEqual(schema.parse(["a"]), ["a"]);
	const result = schema.safeParse([0, 1]);
	assert.equal(result.success, false);
	assert.equal(result.error.issues.length, 1);
	assert.equal(result.error.issues[0].code, "too_big");
});
