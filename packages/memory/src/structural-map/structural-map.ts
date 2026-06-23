import { pathToAreas } from "../path-to-area";
import type { AreaTag } from "../types";

/**
 * Structural-map helpers (PURE LOGIC). These classify a repo-relative path and
 * extract exported symbols from source text with a lightweight regex/heuristic
 * scan — NO parser dependency (Assumption A12). host-service may prefer the
 * TypeScript compiler API when the `typescript` package is present and fall
 * back to {@link extractExportedSymbols} here; this regex extractor is the
 * portable baseline and is what the unit tests pin.
 */

/** A single extracted top-level export. */
export interface ExtractedSymbol {
	name: string;
	/** Coarse kind hint from the declaration keyword. */
	kind:
		| "function"
		| "class"
		| "const"
		| "let"
		| "var"
		| "type"
		| "interface"
		| "enum"
		| "default"
		| "reexport";
}

/** A computed structural-map entry for one file (before persistence). */
export interface StructuralEntry {
	/** Repo-relative POSIX path. */
	path: string;
	kind: "file";
	areaTags: AreaTag[];
	/** Exported symbols, or [] when none/not a source file. */
	symbols: ExtractedSymbol[];
	/** One-line "where X lives" summary (areas + top symbols). */
	summary: string;
}

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
]);

/** Whether a path looks like a TS/JS source file worth symbol extraction. */
export function isSourceFile(path: string): boolean {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf(".");
	if (dot === -1) return false;
	return SOURCE_EXTENSIONS.has(lower.slice(dot));
}

const DECL_KEYWORD_TO_KIND: Record<string, ExtractedSymbol["kind"]> = {
	function: "function",
	class: "class",
	const: "const",
	let: "let",
	var: "var",
	type: "type",
	interface: "interface",
	enum: "enum",
};

/**
 * Extract top-level exported symbol names from source text via regex. Handles:
 *   export function/class/const/let/var/type/interface/enum NAME
 *   export default ...            -> { name: "default", kind: "default" }
 *   export { a, b as c }          -> a, c
 *   export * from "..."           -> { name: "*", kind: "reexport" }
 * Deliberately heuristic (skips, e.g., destructured `export const { x } = ...`).
 * Best-effort and never throws; deduplicates by name.
 */
export function extractExportedSymbols(source: string): ExtractedSymbol[] {
	const found: ExtractedSymbol[] = [];
	const seen = new Set<string>();
	const push = (name: string, kind: ExtractedSymbol["kind"]): void => {
		const key = `${kind}:${name}`;
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ name, kind });
	};

	// Named declarations: export [async] <keyword> <Name>
	const declRe =
		/^\s*export\s+(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
	for (const match of source.matchAll(declRe)) {
		const keyword = match[1];
		const name = match[2];
		if (keyword && name) push(name, DECL_KEYWORD_TO_KIND[keyword] ?? "const");
	}

	// export default ...
	if (/^\s*export\s+default\b/m.test(source)) {
		push("default", "default");
	}

	// export { a, b as c, type D } (single or multi-line)
	const namedRe = /export\s*\{([^}]*)\}/g;
	for (const match of source.matchAll(namedRe)) {
		const body = match[1] ?? "";
		for (const raw of body.split(",")) {
			const part = raw.trim().replace(/^type\s+/, "");
			if (!part) continue;
			// "a as b" exports b; otherwise the bare name.
			const asMatch = part.match(/(?:\S+)\s+as\s+([A-Za-z_$][\w$]*)/);
			const exported = asMatch
				? asMatch[1]
				: part.match(/^[A-Za-z_$][\w$]*/)?.[0];
			if (exported) push(exported, "reexport");
		}
	}

	// export * from "..."
	if (/export\s+\*\s+from\s+["']/.test(source)) {
		push("*", "reexport");
	}

	return found;
}

/** Build a terse "where X lives" summary from areas + the leading symbols. */
export function summarizeEntry(options: {
	areaTags: readonly AreaTag[];
	symbols: readonly ExtractedSymbol[];
	maxSymbols?: number;
}): string {
	const { areaTags, symbols, maxSymbols = 8 } = options;
	const areaPart = areaTags.length > 0 ? `[${areaTags.join(", ")}]` : "[other]";
	if (symbols.length === 0) return areaPart;
	const names = symbols.slice(0, maxSymbols).map((s) => s.name);
	const more =
		symbols.length > maxSymbols ? `, +${symbols.length - maxSymbols}` : "";
	return `${areaPart} exports: ${names.join(", ")}${more}`;
}

/**
 * Compute a full structural entry for one file from its repo-relative path and
 * (optional) source text. Non-source files get area tags + an empty symbol
 * list. Pure: the caller supplies the content (host reads from disk).
 */
export function buildStructuralEntry(options: {
	path: string;
	source?: string | null;
}): StructuralEntry {
	const { path, source } = options;
	const areaTags = pathToAreas(path);
	const symbols =
		source && isSourceFile(path) ? extractExportedSymbols(source) : [];
	return {
		path,
		kind: "file",
		areaTags,
		symbols,
		summary: summarizeEntry({ areaTags, symbols }),
	};
}
