import { describe, expect, it } from "bun:test";
import {
	buildStructuralEntry,
	extractExportedSymbols,
	isSourceFile,
	summarizeEntry,
} from "./structural-map";

describe("isSourceFile", () => {
	it("recognizes TS/JS extensions", () => {
		expect(isSourceFile("a/b/c.ts")).toBe(true);
		expect(isSourceFile("a.tsx")).toBe(true);
		expect(isSourceFile("a.mjs")).toBe(true);
		expect(isSourceFile("a.cts")).toBe(true);
	});

	it("rejects non-source files", () => {
		expect(isSourceFile("README.md")).toBe(false);
		expect(isSourceFile("data.json")).toBe(false);
		expect(isSourceFile("noext")).toBe(false);
	});
});

describe("extractExportedSymbols", () => {
	it("extracts named declaration exports with kinds", () => {
		const src = [
			"export function doThing() {}",
			"export async function doAsync() {}",
			"export class Widget {}",
			"export const VALUE = 1;",
			"export type Foo = string;",
			"export interface Bar {}",
			"export enum Color { Red }",
		].join("\n");
		const syms = extractExportedSymbols(src);
		const byName = Object.fromEntries(syms.map((s) => [s.name, s.kind]));
		expect(byName.doThing).toBe("function");
		expect(byName.doAsync).toBe("function");
		expect(byName.Widget).toBe("class");
		expect(byName.VALUE).toBe("const");
		expect(byName.Foo).toBe("type");
		expect(byName.Bar).toBe("interface");
		expect(byName.Color).toBe("enum");
	});

	it("extracts default exports", () => {
		const syms = extractExportedSymbols("export default function () {}");
		expect(syms.some((s) => s.name === "default" && s.kind === "default")).toBe(
			true,
		);
	});

	it("extracts named re-exports including aliases", () => {
		const src = 'export { foo, bar as baz, type Qux } from "./mod";';
		const names = extractExportedSymbols(src).map((s) => s.name);
		expect(names).toContain("foo");
		expect(names).toContain("baz");
		expect(names).toContain("Qux");
		expect(names).not.toContain("bar"); // aliased away
	});

	it("extracts star re-exports", () => {
		const syms = extractExportedSymbols('export * from "./barrel";');
		expect(syms.some((s) => s.name === "*")).toBe(true);
	});

	it("ignores non-exported declarations", () => {
		const syms = extractExportedSymbols(
			"function privateFn() {}\nconst hidden = 1;",
		);
		expect(syms).toHaveLength(0);
	});

	it("deduplicates", () => {
		const src = "export const A = 1;\nexport const A = 2;";
		const syms = extractExportedSymbols(src).filter((s) => s.name === "A");
		expect(syms).toHaveLength(1);
	});

	it("never throws on empty or garbage input", () => {
		expect(extractExportedSymbols("")).toEqual([]);
		expect(() => extractExportedSymbols("}{)(")).not.toThrow();
	});
});

describe("summarizeEntry", () => {
	it("includes areas and leading symbol names", () => {
		const summary = summarizeEntry({
			areaTags: ["backend"],
			symbols: [
				{ name: "foo", kind: "function" },
				{ name: "Bar", kind: "class" },
			],
		});
		expect(summary).toContain("backend");
		expect(summary).toContain("foo");
		expect(summary).toContain("Bar");
	});

	it("caps the symbol list with a +N marker", () => {
		const symbols = Array.from({ length: 12 }, (_, i) => ({
			name: `s${i}`,
			kind: "const" as const,
		}));
		const summary = summarizeEntry({ areaTags: ["frontend"], symbols });
		expect(summary).toContain("+4");
	});
});

describe("buildStructuralEntry", () => {
	it("derives areas + symbols for a source file", () => {
		const entry = buildStructuralEntry({
			path: "packages/host-service/src/foo.ts",
			source: "export const handler = () => {};",
		});
		expect(entry.kind).toBe("file");
		expect(entry.areaTags).toContain("backend");
		expect(entry.symbols.map((s) => s.name)).toContain("handler");
		expect(entry.summary).toContain("handler");
	});

	it("returns empty symbols for non-source files", () => {
		const entry = buildStructuralEntry({
			path: "packages/db/src/schema/users.ts",
			source: null,
		});
		expect(entry.symbols).toEqual([]);
		expect(entry.areaTags).toContain("schema");
	});
});
