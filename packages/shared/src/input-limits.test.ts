import { expect, test } from "bun:test";
import {
	assertInputWithinLimits,
	assertJsonTextWithinLimits,
	INPUT_LIMITS,
	InputLimitError,
} from "./input-limits";

test("rejects huge collections before touching any child", () => {
	const values = new Array(INPUT_LIMITS.collectionEntries + 1);
	Object.defineProperty(values, 0, {
		get: () => {
			throw new Error("child visited");
		},
	});
	expect(() => assertInputWithinLimits(values)).toThrow(InputLimitError);
});
test("accepts the collection boundary and ordinary structured values", () => {
	expect(() =>
		assertInputWithinLimits(Array(INPUT_LIMITS.collectionEntries).fill("ok")),
	).not.toThrow();
	expect(() =>
		assertInputWithinLimits({
			date: new Date(),
			map: new Map([["key", 1]]),
			set: new Set([1]),
			bytes: new Uint8Array(4),
		}),
	).not.toThrow();
});
test("bounds Maps and Sets before iterating entries", () => {
	expect(() =>
		assertInputWithinLimits(
			new Set(
				Array.from({ length: INPUT_LIMITS.collectionEntries + 1 }, (_, i) => i),
			),
		),
	).toThrow(InputLimitError);
	expect(() =>
		assertInputWithinLimits(
			new Map(
				Array.from({ length: INPUT_LIMITS.collectionEntries + 1 }, (_, i) => [
					i,
					i,
				]),
			),
		),
	).toThrow(InputLimitError);
});
test("bounds aggregate nodes across many small collections", () => {
	expect(() =>
		assertInputWithinLimits(
			Array.from({ length: 100 }, () => Array(256).fill(0)),
		),
	).toThrow("total values");
});
test("bounds nesting and cyclic direct/IPC input without recursive traversal", () => {
	let value: unknown = 0;
	for (let i = 0; i < INPUT_LIMITS.depth; i++) value = [value];
	expect(() => assertInputWithinLimits(value)).not.toThrow();
	expect(() => assertInputWithinLimits([value])).toThrow("nesting depth");
	const cycle: unknown[] = [];
	cycle.push(cycle);
	expect(() => assertInputWithinLimits(cycle)).toThrow("nesting depth");
});
test("bounds object keys, aggregate text and binary input", () => {
	expect(() =>
		assertInputWithinLimits(
			Object.fromEntries(
				Array.from({ length: INPUT_LIMITS.objectKeys + 1 }, (_, i) => [
					`k${i}`,
					0,
				]),
			),
		),
	).toThrow("object keys");
	expect(() =>
		assertInputWithinLimits([
			"x".repeat(INPUT_LIMITS.textCodeUnits / 2),
			"x".repeat(INPUT_LIMITS.textCodeUnits / 2 + 1),
		]),
	).toThrow("total text");
	expect(() =>
		assertInputWithinLimits(new Uint8Array(INPUT_LIMITS.binaryBytes + 1)),
	).toThrow("binary size");
});

test("JSON scan bounds compact containers before JSON.parse allocates them", () => {
	expect(() => assertJsonTextWithinLimits(`[${"0,".repeat(4096)}0]`)).toThrow(
		"collection entries",
	);
	expect(() =>
		assertJsonTextWithinLimits(`${"[".repeat(34)}0${"]".repeat(34)}`),
	).toThrow("nesting depth");
	expect(() =>
		assertJsonTextWithinLimits(
			JSON.stringify(
				Object.fromEntries(
					Array.from({ length: 1025 }, (_, i) => [`k${i}`, 0]),
				),
			),
		),
	).toThrow("object keys");
	expect(() =>
		assertJsonTextWithinLimits(
			JSON.stringify(Array.from({ length: 100 }, () => Array(256).fill(0))),
		),
	).toThrow("total values");
});
test("JSON scan preserves ordinary nested values, empty collections and escaped punctuation", () => {
	for (const value of [
		null,
		42,
		true,
		false,
		"hello",
		[],
		{},
		{ empty: [], value: { items: [1, "a", false, null] } },
		{ text: '[{,}]:\\"'.repeat(5000) },
	]) {
		const text = JSON.stringify(value);
		expect(() => assertJsonTextWithinLimits(text)).not.toThrow();
	}
	const text = JSON.stringify(Array(4096).fill(0));
	expect(() => assertJsonTextWithinLimits(text)).not.toThrow();
});
