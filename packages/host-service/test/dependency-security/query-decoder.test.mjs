import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Worker } from "node:worker_threads";

const sharedRequire = createRequire(
	new URL(
		"../../../../node_modules/.bun/node_modules/package.json",
		import.meta.url,
	),
);
for (const parent of ["@react-navigation/core", "expo-router"]) {
	const parentRequire = createRequire(sharedRequire.resolve(parent));
	const query = parentRequire("query-string");
	test(`${parent} retains query-string API with patched decoder`, async (t) => {
		await t.test(
			"duplicates, flags, empty values and optional coercion",
			() => {
				assert.deepEqual(
					{
						...query.parse("n=1&enabled=true&empty=&flag&list=a&list=b", {
							parseNumbers: true,
							parseBooleans: true,
						}),
					},
					{ n: 1, enabled: true, empty: "", flag: null, list: ["a", "b"] },
				);
			},
		);
		await t.test("unicode, spaces and literal plus signs round-trip", () => {
			const input = { q: "a + β/東京", blank: "", flag: null };
			assert.deepEqual({ ...query.parse(query.stringify(input)) }, input);
		});
		await t.test("bracket arrays remain supported", () => {
			assert.deepEqual(
				{
					...query.parse("items[]=one&items[]=two", { arrayFormat: "bracket" }),
				},
				{ items: ["one", "two"] },
			);
		});
		await t.test("URL and fragment parsing remain supported", () => {
			const result = query.parseUrl(
				"https://example.invalid/path?q=hello%20world#section%20one",
				{ parseFragmentIdentifier: true },
			);
			assert.equal(result.url, "https://example.invalid/path");
			assert.equal(result.query.q, "hello world");
			assert.equal(result.fragmentIdentifier, "section one");
		});
		await t.test(
			"malformed percent input is preserved without throwing",
			() => {
				assert.equal(query.parse("q=%ZZ").q, "%ZZ");
			},
		);
		await t.test("decoded prototype-shaped keys stay inert data", () => {
			const result = query.parse("%5F%5Fproto%5F%5F=value&constructor=own");
			assert.equal(Object.getPrototypeOf(result), null);
			assert.equal(result.__proto__, "value");
			assert.equal(result.constructor, "own");
		});
	});
}

test(
	"patched decoder handles a repeated malformed UTF-8 sequence within a bounded worker",
	{ timeout: 5000 },
	async () => {
		const parentRequire = createRequire(sharedRequire.resolve("expo-router"));
		const queryRequire = createRequire(parentRequire.resolve("query-string"));
		const worker = new Worker(
			`
    const {parentPort,workerData}=require('node:worker_threads');
    const {pathToFileURL}=require('node:url');
    import(pathToFileURL(workerData.module).href).then(({default:decode}) => {
      parentPort.postMessage(typeof decode(workerData.payload));
    });
  `,
			{
				eval: true,
				workerData: {
					module: queryRequire.resolve("decode-uri-component"),
					payload: "%E0%A4%A".repeat(2000),
				},
			},
		);
		let timer;
		try {
			const result = await Promise.race([
				new Promise((resolve, reject) => {
					worker.once("message", resolve);
					worker.once("error", reject);
				}),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("decoder resource-bound check timed out")),
						3000,
					);
				}),
			]);
			assert.equal(result, "string");
		} finally {
			clearTimeout(timer);
			await worker.terminate();
		}
	},
);

test("Metro's real module transform preserves the decoder bridge", () => {
	const parentRequire = createRequire(sharedRequire.resolve("expo-router"));
	const queryPath = parentRequire.resolve("query-string");
	const queryRequire = createRequire(queryPath);
	const decoderSource = readFileSync(
		queryRequire.resolve("decode-uri-component"),
		"utf8",
	);
	const babel = sharedRequire("@babel/core");
	const metro = sharedRequire("metro-transform-plugins");
	const { code } = babel.transformSync(decoderSource, {
		babelrc: false,
		configFile: false,
		plugins: [
			[
				metro.importExportPlugin,
				{ importAll: "_importAll", importDefault: "_importDefault" },
			],
		],
	});
	const decodedModule = { exports: {} };
	runInNewContext(
		code,
		{ module: decodedModule, exports: decodedModule.exports },
		{ timeout: 1000 },
	);
	assert.equal(typeof decodedModule.exports.default, "function");
	const queryModule = { exports: {} };
	runInNewContext(
		readFileSync(queryPath, "utf8"),
		{
			module: queryModule,
			exports: queryModule.exports,
			require: (name) =>
				name === "decode-uri-component"
					? decodedModule.exports
					: queryRequire(name),
		},
		{ timeout: 1000 },
	);
	assert.equal(
		queryModule.exports.parse("q=%E6%9D%B1%E4%BA%AC%2B%20x").q,
		"東京+ x",
	);
});
