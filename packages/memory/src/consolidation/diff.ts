/**
 * A tiny, deterministic line diff (PURE LOGIC) for the consolidation review UI.
 * The renderer must not import a Node diff lib, so the LCS-based line diff lives
 * here in the shared pure package. Good enough for showing current-vs-proposed
 * Practice docs (line granularity); not a full Myers diff.
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
	op: DiffOp;
	text: string;
}

export interface LineDiff {
	lines: DiffLine[];
	added: number;
	removed: number;
}

function splitLines(text: string): string[] {
	if (text.length === 0) return [];
	// Drop a single trailing newline so a doc ending in "\n" doesn't yield a
	// phantom empty last line in the diff.
	const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
	return normalized.split("\n");
}

/**
 * Compute a line-level diff between `before` and `after` using a longest-common-
 * subsequence backtrace. Returns the ordered ops plus add/remove counts.
 */
export function computeLineDiff(args: {
	before: string;
	after: string;
}): LineDiff {
	const a = splitLines(args.before);
	const b = splitLines(args.after);
	const n = a.length;
	const m = b.length;

	// LCS length table as a flat (n+1)×(m+1) typed array — avoids nested-array
	// undefined access under `noUncheckedIndexedAccess` and is contiguous.
	const width = m + 1;
	const lcs = new Int32Array((n + 1) * width);
	const lcsAt = (row: number, col: number): number =>
		lcs[row * width + col] ?? 0;
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] =
				a[i] === b[j]
					? lcsAt(i + 1, j + 1) + 1
					: Math.max(lcsAt(i + 1, j), lcsAt(i, j + 1));
		}
	}

	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const left = a[i] ?? "";
		const right = b[j] ?? "";
		if (left === right) {
			lines.push({ op: "equal", text: left });
			i++;
			j++;
		} else if (lcsAt(i + 1, j) >= lcsAt(i, j + 1)) {
			lines.push({ op: "remove", text: left });
			removed++;
			i++;
		} else {
			lines.push({ op: "add", text: right });
			added++;
			j++;
		}
	}
	while (i < n) {
		lines.push({ op: "remove", text: a[i] ?? "" });
		removed++;
		i++;
	}
	while (j < m) {
		lines.push({ op: "add", text: b[j] ?? "" });
		added++;
		j++;
	}

	return { lines, added, removed };
}
