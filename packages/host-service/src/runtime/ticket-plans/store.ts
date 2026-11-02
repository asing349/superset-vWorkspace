import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	assertInputWithinLimits,
	assertJsonTextWithinLimits,
	INPUT_LIMITS,
	InputLimitError,
} from "@superset/shared/input-limits";
import { readLimitedTextFile } from "@superset/shared/limited-file";
import { z } from "zod";
import { planRecordSchema, type TicketPlanRecord } from "./types";

/** Local artifacts, atomically replaced; no cloud schema or database migrations. */
export class TicketPlanStore {
	constructor(private readonly directory: string) {}
	private path(id: string): string {
		return join(this.directory, `${z.string().uuid().parse(id)}.json`);
	}
	get(id: string): TicketPlanRecord {
		const path = this.path(id);
		const text = readLimitedTextFile(path);
		assertJsonTextWithinLimits(text);
		const raw: unknown = JSON.parse(text);
		assertInputWithinLimits(raw);
		return planRecordSchema.parse(raw);
	}
	put(record: TicketPlanRecord): void {
		assertInputWithinLimits(record);
		const value = planRecordSchema.parse(record);
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const target = this.path(value.id);
		const temporary = `${target}.${crypto.randomUUID()}.tmp`;
		const serialized = JSON.stringify(value);
		if (Buffer.byteLength(serialized) > INPUT_LIMITS.requestBytes)
			throw new InputLimitError("plan file size");
		writeFileSync(temporary, serialized, { mode: 0o600 });
		renameSync(temporary, target);
	}
}
