import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

const sharedRequire = createRequire(
	new URL(
		"../../../../node_modules/.bun/node_modules/package.json",
		import.meta.url,
	),
);
const nativeCliRequire = createRequire(
	sharedRequire.resolve("@react-native/community-cli-plugin"),
);
const metroRequire = createRequire(nativeCliRequire.resolve("metro"));
assert.equal(metroRequire("image-size/package.json").version, "1.2.1");
const imagePath = metroRequire.resolve("image-size");
const { imageSize } = metroRequire("image-size");
function box(
	type,
	payload = Buffer.alloc(0),
	declaredSize = 8 + payload.length,
) {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(declaredSize);
	header.write(type, 4, "ascii");
	return Buffer.concat([header, payload]);
}
function icns(entryLength = 8) {
	const header = Buffer.alloc(8);
	header.write("icns");
	header.writeUInt32BE(16, 4);
	const entry = Buffer.alloc(8);
	entry.write("icp4");
	entry.writeUInt32BE(entryLength, 4);
	return Buffer.concat([header, entry]);
}
const jxlSignature = box("JXL ", Buffer.from([13, 10, 135, 10]));
const jxlBrand = box(
	"ftyp",
	Buffer.concat([Buffer.from("jxl "), Buffer.alloc(4), Buffer.from("jxl ")]),
);
const stream = Buffer.from([0xff, 0x0a, 1, 0]);
function heif(ispeLength = 20) {
	const size = Buffer.alloc(12);
	size.writeUInt32BE(12, 4);
	size.writeUInt32BE(34, 8);
	return Buffer.concat([
		box(
			"ftyp",
			Buffer.concat([
				Buffer.from("heic"),
				Buffer.alloc(4),
				Buffer.from("heic"),
			]),
		),
		box(
			"meta",
			Buffer.concat([
				Buffer.alloc(4),
				box("iprp", box("ipco", box("ispe", size, ispeLength))),
			]),
		),
	]);
}
async function parseInBoundedWorker(bytes) {
	const worker = new Worker(
		`
    const {parentPort,workerData}=require('node:worker_threads');
    const {imageSize:api}=require(workerData.module);
    try { parentPort.postMessage({ok:true,result:api(Buffer.from(workerData.bytes,'base64'))}); }
    catch(error) { parentPort.postMessage({ok:false,message:error.message}); }
  `,
		{
			eval: true,
			workerData: { module: imagePath, bytes: bytes.toString("base64") },
			resourceLimits: { maxOldGenerationSizeMb: 64 },
		},
	);
	let timer;
	try {
		return await Promise.race([
			once(worker, "message").then(([message]) => message),
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error("image parser exceeded bounded worker budget")),
					1500,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		await worker.terminate();
	}
}

for (const [name, payload] of [
	["zero-length ICNS entry", icns(0)],
	[
		"zero-length JXL partial-stream box",
		Buffer.concat([jxlSignature, jxlBrand, box("jxlp", Buffer.alloc(0), 0)]),
	],
	["undersized HEIF spatial box", heif(8)],
]) {
	test(`rejects ${name} without hanging`, { timeout: 4000 }, async () => {
		const result = await parseInBoundedWorker(payload);
		assert.equal(result.ok, false);
		assert.match(result.message, /Invalid (ICNS|HEIF|JXL)/);
	});
}

test("legacy Buffer API preserves valid ICNS, HEIF and JXL dimensions", () => {
	assert.equal(typeof imageSize, "function");
	const icon = imageSize(icns());
	assert.equal(icon.width, 16);
	assert.equal(icon.height, 16);
	const heic = imageSize(heif());
	assert.equal(heic.width, 12);
	assert.equal(heic.height, 34);
	for (const data of [
		Buffer.concat([jxlSignature, jxlBrand, box("jxlc", stream)]),
		Buffer.concat([
			jxlSignature,
			jxlBrand,
			box("jxlp", Buffer.concat([Buffer.alloc(4), stream])),
		]),
	]) {
		const result = imageSize(data);
		assert.equal(result.width, 8);
		assert.equal(result.height, 8);
	}
});

test("legacy file and callback APIs remain compatible with Metro", async () => {
	const dir = await mkdtemp(join(tmpdir(), "superset-image-size-"));
	try {
		const file = join(dir, "image.png");
		await writeFile(
			file,
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+9gAAAABJRU5ErkJggg==",
				"base64",
			),
		);
		const sync = imageSize(file);
		assert.equal(sync.width, 1);
		assert.equal(sync.height, 1);
		const async = await new Promise((resolve, reject) =>
			imageSize(file, (error, value) =>
				error ? reject(error) : resolve(value),
			),
		);
		assert.deepEqual(async, sync);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
