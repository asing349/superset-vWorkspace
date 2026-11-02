import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Resolve the maintained extractor already supplied by Electron, without loading
// Electron itself or launching a browser. The override also serves Puppeteer.
const require = createRequire(import.meta.url);
const electronRequire = createRequire(require.resolve("electron/package.json"));
const { default: extract } = electronRequire(
	"@electron-internal/extract-zip",
) as {
	default: (archive: string, options: { dir: string }) => Promise<void>;
};
const fixtures = resolve(import.meta.dirname, "fixtures");
let root: string;
let output: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "superset-archive-security-"));
	output = join(root, "output");
	await mkdir(output);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe("maintained ZIP extractor compatibility and containment", () => {
	test("extracts ordinary browser payloads", async () => {
		await extract(join(fixtures, "normal.zip"), { dir: output });
		expect(await readFile(join(output, "dir/hello.txt"), "utf8")).toBe("hello");
	});
	test.skipIf(process.platform === "win32")(
		"preserves contained framework symlink chains",
		async () => {
			await extract(join(fixtures, "framework-symlinks.zip"), { dir: output });
			expect(await readFile(join(output, "Current"), "utf8")).toBe("framework");
			expect(await realpath(join(output, "Current"))).toBe(
				join(output, "Versions/A/lib.txt"),
			);
		},
	);
	test("rejects an archive parent traversal", async () => {
		await expect(
			extract(join(fixtures, "parent-traversal.zip"), { dir: output }),
		).rejects.toThrow();
		await expect(readFile(join(root, "outside.txt"))).rejects.toThrow();
	});
	test.skipIf(process.platform === "win32")(
		"rejects archive symlinks that escape the extraction root",
		async () => {
			await mkdir(join(root, "outside"));
			await expect(
				extract(join(fixtures, "escaping-symlink.zip"), { dir: output }),
			).rejects.toThrow();
			await expect(
				readFile(join(root, "outside/payload.txt")),
			).rejects.toThrow();
		},
	);
	test.skipIf(process.platform === "win32")(
		"does not overwrite a file through an existing symlink",
		async () => {
			const outside = join(root, "outside.txt");
			await writeFile(outside, "sentinel");
			await symlink(outside, join(output, "target.txt"));
			await extract(join(fixtures, "existing-symlink-target.zip"), {
				dir: output,
			});
			expect((await lstat(join(output, "target.txt"))).isSymbolicLink()).toBe(
				false,
			);
			expect(await readFile(join(output, "target.txt"), "utf8")).toBe(
				"overwrite",
			);
			expect(await readFile(outside, "utf8")).toBe("sentinel");
		},
	);
});
