import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

const sharedRequire = createRequire(
	new URL(
		"../../../../node_modules/.bun/node_modules/package.json",
		import.meta.url,
	),
);
const baseline = JSON.parse(
	readFileSync(
		new URL("./katex-render-baseline.json", import.meta.url),
		"utf8",
	),
);

function exercise(api) {
	const formula = "\\frac{a}{b}+x^2";
	const link = "\\href{javascript:alert(1)}{x}";
	const normal = api.renderToString(formula);
	const blocked = (options) =>
		!api.renderToString(link, options).includes("<a href=");
	function polluted(key, value, callback) {
		const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
		Object.defineProperty(Object.prototype, key, {
			value,
			configurable: true,
			writable: true,
		});
		try {
			return callback();
		} finally {
			if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
			else delete Object.prototype[key];
		}
	}
	return {
		normal,
		explicitTrust: api
			.renderToString("\\href{https://example.invalid}{x}", { trust: true })
			.includes("<a href="),
		inheritedTrust: blocked(Object.create({ trust: true })),
		pollutedTrust: polluted("trust", true, () => blocked()),
		pollutedDefault: polluted("default", true, () => blocked()),
		pollutedProcessor: polluted(
			"processor",
			() => true,
			() => blocked({ trust: false }),
		),
		inheritedMacro: polluted("\\attackerMacro", "x", () =>
			api
				.renderToString("\\attackerMacro", { throwOnError: false })
				.includes("katex-error"),
		),
	};
}

for (const parent of ["mermaid", "react-native-enriched-markdown"]) {
	const parentRequire = createRequire(sharedRequire.resolve(parent));
	const main = parentRequire.resolve("katex");
	const version = parentRequire("katex").version;
	for (const format of ["cjs", "esm", "minified browser"]) {
		test(
			`${parent} KaTeX ${version} ${format} ignores inherited capabilities`,
			{ timeout: 8000 },
			async () => {
				const worker = new Worker(
					`
        const {parentPort,workerData}=require('node:worker_threads');
        const fs=require('node:fs'); const vm=require('node:vm'); const {pathToFileURL}=require('node:url');
        const exercise=${exercise.toString()};
        (async()=>{
          let result;
          if(workerData.format==='minified browser'){
            const context=vm.createContext({});
            vm.runInContext(fs.readFileSync(workerData.min,'utf8'),context,{timeout:2000});
            result=vm.runInContext('('+exercise.toString()+')(katex)',context,{timeout:2000});
          }else{
            const module=workerData.format==='esm'?await import(pathToFileURL(workerData.esm).href):require(workerData.main);
            result=exercise(module.default??module);
          }
          parentPort.postMessage(result);
        })().catch(error=>{throw error});
      `,
					{
						eval: true,
						workerData: {
							format,
							main,
							esm: join(dirname(main), "katex.mjs"),
							min: join(dirname(main), "katex.min.js"),
						},
						resourceLimits: { maxOldGenerationSizeMb: 128 },
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
								() => reject(new Error("KaTeX worker exceeded budget")),
								5000,
							);
						}),
					]);
					assert.equal(
						createHash("sha256").update(result.normal).digest("hex"),
						baseline[version],
					);
					for (const key of [
						"explicitTrust",
						"inheritedTrust",
						"pollutedTrust",
						"pollutedDefault",
						"pollutedProcessor",
						"inheritedMacro",
					])
						assert.equal(result[key], true, key);
				} finally {
					clearTimeout(timer);
					await worker.terminate();
				}
			},
		);
	}
}
