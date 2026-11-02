import { closeSync, openSync, readSync } from "node:fs";
import { INPUT_LIMITS, InputLimitError } from "./input-limits";

/** Enforce the actual read budget, including files that grow after opening. */
export function readLimitedTextFile(path: string): string {
	const fd = openSync(path, "r");
	try {
		const bytes = Buffer.allocUnsafe(INPUT_LIMITS.requestBytes + 1);
		let used = 0;
		while (used < bytes.length) {
			const count = readSync(fd, bytes, used, bytes.length - used, null);
			if (count === 0) break;
			used += count;
		}
		if (used > INPUT_LIMITS.requestBytes)
			throw new InputLimitError("file size");
		return bytes.subarray(0, used).toString("utf8");
	} finally {
		closeSync(fd);
	}
}
