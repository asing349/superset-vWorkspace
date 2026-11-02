import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = new URL("../../../../node_modules/.bun/", import.meta.url)
	.pathname;
const require = createRequire(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function counted(controller, reason) {
	const count = { calls: 0 };
	const next = () => {
		if (++count.calls === 1) controller.abort(reason);
	};
	return {
		count,
		fs: {
			...fs,
			readdir: (...args) => {
				next();
				return fs.readdir(...args);
			},
			readdirSync: (...args) => {
				next();
				return fs.readdirSync(...args);
			},
		},
	};
}
async function streamError(stream) {
	let timer;
	try {
		return await Promise.race([
			new Promise((resolve, reject) => {
				stream.once("error", resolve);
				stream.once("end", () => reject(new Error("expected cancellation")));
				stream.resume();
			}),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("aborted stream did not settle")),
					2000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		stream.destroy();
	}
}
for (const version of ["10.5.0", "11.1.0", "13.0.6"]) {
	for (const format of ["cjs", "esm"]) {
		const path = join(
			root,
			`glob@${version}/node_modules/glob/dist/${format === "cjs" ? "commonjs" : "esm"}/index.js`,
		);
		const api =
			format === "cjs" ? require(path) : await import(pathToFileURL(path).href);
		test(
			`glob ${version} ${format} cancels traversal and preserves APIs`,
			{ timeout: 10000 },
			async (t) => {
				const cwd = await mkdtemp(join(tmpdir(), "superset-glob-budget-"));
				async function tree(dir, depth) {
					await writeFile(join(dir, "file.txt"), "fixture");
					if (!depth) return;
					for (const name of ["a", "b"]) {
						const child = join(dir, name);
						await mkdir(child);
						await tree(child, depth - 1);
					}
				}
				await tree(cwd, 3);
				try {
					await t.test(
						"async walk performs no more reads after cancellation",
						async () => {
							const controller = new AbortController();
							const reason = new Error("fixture-abort");
							const c = counted(controller, reason);
							await assert.rejects(
								api.glob("**", { cwd, signal: controller.signal, fs: c.fs }),
								(error) => error === reason,
							);
							const atReject = c.count.calls;
							await delay(25);
							assert.equal(c.count.calls, atReject);
							assert.equal(c.count.calls, 1);
						},
					);
					for (const method of ["globStream", "globStreamSync"]) {
						await t.test(
							`${method} cancels without background reads or hanging`,
							async () => {
								const controller = new AbortController();
								const reason = new Error("fixture-stream-abort");
								const c = counted(controller, reason);
								const stream = api[method]("**", {
									cwd,
									signal: controller.signal,
									fs: c.fs,
								});
								assert.equal(await streamError(stream), reason);
								const atReject = c.count.calls;
								await delay(25);
								assert.equal(c.count.calls, atReject);
								assert.equal(c.count.calls, 1);
							},
						);
					}
					await t.test("ordinary async and sync matches agree", async () => {
						assert.deepEqual(
							(await api.glob("**/*.txt", { cwd })).sort(),
							api.globSync("**/*.txt", { cwd }).sort(),
						);
						assert.equal(api.globSync("**/*.txt", { cwd }).length, 15);
					});
					await t.test(
						"paused streams resume and retain all matches",
						async () => {
							const stream = api.globStream("**", { cwd });
							await delay(20);
							const found = [];
							for await (const entry of stream) found.push(entry);
							assert.deepEqual(
								found.sort(),
								api.globSync("**", { cwd }).sort(),
							);
						},
					);
				} finally {
					await rm(cwd, { recursive: true, force: true });
				}
			},
		);
	}
}
