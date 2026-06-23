import {
	type ExtractedSymbol,
	isSourceFile,
	extractExportedSymbols as regexExtract,
} from "@superset/memory";
import ts from "typescript";

/**
 * Exported-symbol extraction for the project index (B3).
 *
 * Prefers the TypeScript compiler API (host-service already depends on
 * `typescript`) for accurate top-level export detection, and falls back to the
 * pure regex extractor from `@superset/memory` when the source isn't TS/JS or
 * if the compiler scan throws for any reason. No heavyweight new parser is
 * added (Assumption A12). Lightweight: a single `createSourceFile` per file,
 * no full program/type-checker.
 */

function kindFromNode(node: ts.Node): ExtractedSymbol["kind"] {
	if (ts.isFunctionDeclaration(node)) return "function";
	if (ts.isClassDeclaration(node)) return "class";
	if (ts.isInterfaceDeclaration(node)) return "interface";
	if (ts.isTypeAliasDeclaration(node)) return "type";
	if (ts.isEnumDeclaration(node)) return "enum";
	return "const";
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = ts.canHaveModifiers(node)
		? ts.getModifiers(node)
		: undefined;
	return modifiers?.some((m) => m.kind === kind) ?? false;
}

function hasExportModifier(node: ts.Node): boolean {
	return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function collectFromSourceFile(sourceFile: ts.SourceFile): ExtractedSymbol[] {
	const found: ExtractedSymbol[] = [];
	const seen = new Set<string>();
	const push = (name: string, kind: ExtractedSymbol["kind"]): void => {
		const key = `${kind}:${name}`;
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ name, kind });
	};

	for (const statement of sourceFile.statements) {
		// export default ...
		if (
			ts.isExportAssignment(statement) ||
			(hasExportModifier(statement) &&
				hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
		) {
			push("default", "default");
			continue;
		}

		// export { a, b as c } [from "..."]  and  export * from "..."
		if (ts.isExportDeclaration(statement)) {
			if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
				for (const element of statement.exportClause.elements) {
					push(element.name.text, "reexport");
				}
			} else {
				push("*", "reexport");
			}
			continue;
		}

		if (!hasExportModifier(statement)) continue;

		if (
			ts.isFunctionDeclaration(statement) ||
			ts.isClassDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isTypeAliasDeclaration(statement) ||
			ts.isEnumDeclaration(statement)
		) {
			if (statement.name) push(statement.name.text, kindFromNode(statement));
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			for (const decl of statement.declarationList.declarations) {
				if (ts.isIdentifier(decl.name)) push(decl.name.text, "const");
			}
		}
	}

	return found;
}

/**
 * Extract exported symbols from a file's source. Uses the TS compiler API for
 * TS/JS files; falls back to the pure regex extractor for everything else or on
 * any compiler error. Never throws.
 */
export function extractSymbols(options: {
	path: string;
	source: string;
}): ExtractedSymbol[] {
	const { path, source } = options;
	if (!isSourceFile(path)) return [];
	try {
		const sourceFile = ts.createSourceFile(
			path,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ false,
			path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		return collectFromSourceFile(sourceFile);
	} catch {
		return regexExtract(source);
	}
}
