/** Input budgets apply before schema validation, including direct/IPC callers. */
export const INPUT_LIMITS = {
	repositories: 32,
	agents: 16,
	files: 16,
	labels: 128,
	mcpScopes: 128,
	batchCalls: 32,
	collectionEntries: 4096,
	objectKeys: 1024,
	nodes: 20_000,
	depth: 32,
	textCodeUnits: 36 * 1024 * 1024,
	binaryBytes: 36 * 1024 * 1024,
	requestBytes: 4 * 1024 * 1024,
	attachmentRequestBytes: 36 * 1024 * 1024,
	urlBytes: 64 * 1024,
} as const;

export class InputLimitError extends Error {
	constructor(budget: string) {
		super(`Input exceeds the supported ${budget} limit.`);
		this.name = "InputLimitError";
	}
}

/** Bounded iterative traversal: no per-element validation errors or recursion. */
export function assertInputWithinLimits(input: unknown): void {
	const stack: { value: unknown; depth: number }[] = [
		{ value: input, depth: 0 },
	];
	let nodes = 1;
	let text = 0;
	let binary = 0;
	const push = (value: unknown, depth: number) => {
		if (++nodes > INPUT_LIMITS.nodes) throw new InputLimitError("total values");
		if (depth > INPUT_LIMITS.depth) throw new InputLimitError("nesting depth");
		stack.push({ value, depth });
	};
	while (stack.length) {
		const item = stack.pop();
		if (!item) break;
		const { value, depth } = item;
		if (typeof value === "string") {
			text += value.length;
			if (text > INPUT_LIMITS.textCodeUnits)
				throw new InputLimitError("total text");
		} else if (value && typeof value === "object") {
			if (typeof Blob !== "undefined" && value instanceof Blob) {
				binary += value.size;
				if (binary > INPUT_LIMITS.binaryBytes)
					throw new InputLimitError("binary size");
			} else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
				binary += value.byteLength;
				if (binary > INPUT_LIMITS.binaryBytes)
					throw new InputLimitError("binary size");
			} else if (Array.isArray(value)) {
				if (value.length > INPUT_LIMITS.collectionEntries)
					throw new InputLimitError("collection entries");
				for (const child of value) push(child, depth + 1);
			} else if (value instanceof Map) {
				if (value.size > INPUT_LIMITS.collectionEntries)
					throw new InputLimitError("collection entries");
				for (const [key, child] of value) {
					push(key, depth + 1);
					push(child, depth + 1);
				}
			} else if (value instanceof Set) {
				if (value.size > INPUT_LIMITS.collectionEntries)
					throw new InputLimitError("collection entries");
				for (const child of value) push(child, depth + 1);
			} else {
				let keys = 0;
				for (const key in value) {
					if (!Object.hasOwn(value, key)) continue;
					if (++keys > INPUT_LIMITS.objectKeys)
						throw new InputLimitError("object keys");
					text += key.length;
					if (text > INPUT_LIMITS.textCodeUnits)
						throw new InputLimitError("total text");
					push((value as Record<string, unknown>)[key], depth + 1);
				}
			}
		}
	}
}

/** Budget-only JSON scan before JSON.parse allocates containers. Syntax remains
 * the native parser's job; quoted/escaped punctuation never counts as structure.
 */
export function assertJsonTextWithinLimits(text: string): void {
	const stack: { kind: string; entries: number; key: boolean }[] = [];
	let nodes = 0;
	const value = () => {
		if (++nodes > INPUT_LIMITS.nodes) throw new InputLimitError("total values");
		if (stack.length > INPUT_LIMITS.depth)
			throw new InputLimitError("nesting depth");
		const parent = stack.at(-1);
		if (
			parent?.kind === "[" &&
			++parent.entries > INPUT_LIMITS.collectionEntries
		)
			throw new InputLimitError("collection entries");
	};
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (
			char === " " ||
			char === "\n" ||
			char === "\r" ||
			char === "\t" ||
			char === ":"
		)
			continue;
		const current = stack.at(-1);
		if (char === ",") {
			if (current?.kind === "{") current.key = true;
			continue;
		}
		if (char === "}" || char === "]") {
			stack.pop();
			continue;
		}
		if (char === '"') {
			if (current?.kind === "{" && current.key) {
				if (++current.entries > INPUT_LIMITS.objectKeys)
					throw new InputLimitError("object keys");
				current.key = false;
			} else value();
			for (i++; i < text.length; i++) {
				if (text[i] === "\\") i++;
				else if (text[i] === '"') break;
			}
		} else {
			value();
			if (char === "{" || char === "[")
				stack.push({ kind: char, entries: 0, key: char === "{" });
			else
				while (i + 1 < text.length && !/[\s,}\]]/.test(text[i + 1] ?? "")) i++;
		}
	}
}
