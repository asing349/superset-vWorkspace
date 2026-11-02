import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "./input-limits";
import { readLimitedTextFile } from "./limited-file";

test("local file reader permits boundary bytes and rejects one more", () => {
	const dir = mkdtempSync(join(tmpdir(), "input-file-budget-"));
	try {
		const path = join(dir, "config.json");
		writeFileSync(path, "x".repeat(INPUT_LIMITS.requestBytes));
		expect(readLimitedTextFile(path).length).toBe(INPUT_LIMITS.requestBytes);
		writeFileSync(path, "x".repeat(INPUT_LIMITS.requestBytes + 1));
		expect(() => readLimitedTextFile(path)).toThrow("file size");
		writeFileSync(path, '{"ok":"✓"}');
		expect(JSON.parse(readLimitedTextFile(path))).toEqual({ ok: "✓" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
