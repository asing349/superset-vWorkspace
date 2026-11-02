import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

const store = new URL("../../../../node_modules/.bun/", import.meta.url)
	.pathname;
const require = createRequire(import.meta.url);
for (const version of ["3.1.5", "5.1.9"]) {
	const api = require(
		join(store, `minimatch@${version}/node_modules/minimatch/minimatch.js`),
	);
	test(`legacy minimatch ${version} does not contain the affected optimizer`, () => {
		const matcher = new api.Minimatch(Array(30).fill("**/../a/b").join("/"), {
			optimizationLevel: 2,
		});
		assert.equal(typeof matcher.firstPhasePreProcess, "undefined");
		assert.equal(matcher.set.length, 1);
		assert.equal(api("folder/a.txt", "**/*.txt"), true);
		assert.equal(api("folder/a.js", "**/*.txt"), false);
	});
}
for (const version of ["9.0.9", "10.2.4", "10.2.6"]) {
	for (const format of ["cjs", "esm"]) {
		test(
			`minimatch ${version} ${format} bounds optimizer amplification`,
			{ timeout: 7000 },
			async () => {
				const entry = join(
					store,
					`minimatch@${version}/node_modules/minimatch/dist/${format === "cjs" ? "commonjs" : "esm"}/index.js`,
				);
				const worker = new Worker(
					`
        const {parentPort,workerData}=require('node:worker_threads');const{pathToFileURL}=require('node:url');
        (async()=>{
          const api=workerData.format==='cjs'?require(workerData.entry):await import(pathToFileURL(workerData.entry).href);
          const {Minimatch}=api;const opts={optimizationLevel:2};
          const large=new Minimatch(Array(30).fill('**/../a/b').join('/'),{...opts,braceExpandMax:64});
          const small=new Minimatch('**/../a/b/**/../c/d',opts);
          const pairs=new Minimatch('{x,*}/{0..999}',opts);
          parentPort.postMessage({count:large.set.length,smallCount:small.set.length,first:small.match('../a/b/../c/d'),second:small.match('x/a/b/y/c/d'),pairCount:pairs.set.length,pairMatches:pairs.match('x/5')});
        })().catch(error=>{throw error});
      `,
					{
						eval: true,
						workerData: { entry, format },
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
								() => reject(new Error("optimizer exceeded worker budget")),
								5000,
							);
						}),
					]);
					assert.equal(result.count, 64);
					assert.equal(result.smallCount, 4);
					assert.equal(result.first, true);
					assert.equal(result.second, true);
					assert.equal(result.pairCount, 2000);
					assert.equal(result.pairMatches, true);
				} finally {
					clearTimeout(timer);
					await worker.terminate();
				}
			},
		);
	}
}
