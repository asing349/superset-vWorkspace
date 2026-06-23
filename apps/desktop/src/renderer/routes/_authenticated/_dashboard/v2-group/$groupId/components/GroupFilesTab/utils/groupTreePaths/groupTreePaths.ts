/**
 * Pure path helpers for the multi-root ("group") file explorer's mutation flow
 * (A1). The group tree works entirely in ABSOLUTE, POSIX-style paths (unlike the
 * single-workspace Pierre tree, which keys by root-relative paths), so these
 * helpers operate on absolute paths and never need a `rootPath` to round-trip.
 */

/** Normalize separators to `/` and strip any trailing slash (except a bare root). */
export function normalizeAbsolutePath(absolutePath: string): string {
	const normalized = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
	return normalized || "/";
}

/**
 * The parent directory of an absolute path. Returns the input (normalized) when
 * it has no parent (a filesystem root like `/`).
 */
export function getParentDirectory(absolutePath: string): string {
	const normalized = normalizeAbsolutePath(absolutePath);
	const lastSlash = normalized.lastIndexOf("/");
	// A top-level entry (`/a`) has the filesystem root as its parent; a bare root
	// (`/`) is its own parent.
	if (lastSlash < 0 || normalized === "/") return normalized;
	if (lastSlash === 0) return "/";
	return normalized.slice(0, lastSlash);
}

/** Join a parent directory and a child name into a single absolute path. */
export function joinPath(parentDirectory: string, name: string): string {
	const base = normalizeAbsolutePath(parentDirectory);
	const child = name.replace(/^\/+/, "").replace(/\/+$/, "");
	return base === "/" ? `/${child}` : `${base}/${child}`;
}

/** The final path segment (basename) of an absolute path. */
export function getNameFromPath(absolutePath: string): string {
	const normalized = normalizeAbsolutePath(absolutePath);
	const lastSlash = normalized.lastIndexOf("/");
	return lastSlash < 0 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * A name is valid for create/rename when it is non-empty and contains no path
 * separators (we only ever create a single entry, never a nested path) and is
 * not the relative-path specials.
 */
export function isValidEntryName(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	if (trimmed === "." || trimmed === "..") return false;
	return !/[/\\]/.test(trimmed);
}

/**
 * First non-colliding default name for a new inline entry under a directory, of
 * the form `untitled` / `Untitled`, then `untitled-2`, … `existingNames` are the
 * basenames already present in the target directory.
 */
export function pickDefaultEntryName({
	mode,
	existingNames,
}: {
	mode: "file" | "folder";
	existingNames: Iterable<string>;
}): string {
	const taken = new Set(existingNames);
	const base = mode === "folder" ? "Untitled" : "untitled";
	if (!taken.has(base)) return base;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base}-${i}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${base}-${Date.now()}`;
}
