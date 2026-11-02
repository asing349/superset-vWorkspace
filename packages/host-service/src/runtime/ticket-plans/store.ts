import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { planRecordSchema, type TicketPlanRecord } from "./types";

/** Local artifacts, atomically replaced; no cloud schema or database migrations. */
export class TicketPlanStore {
	constructor(private readonly directory: string) {}
	private path(id: string): string {
		return join(this.directory, `${z.string().uuid().parse(id)}.json`);
	}
	get(id: string): TicketPlanRecord {
		return planRecordSchema.parse(
			JSON.parse(readFileSync(this.path(id), "utf8")),
		);
	}
	put(record: TicketPlanRecord): void {
		const value = planRecordSchema.parse(record);
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const target = this.path(value.id);
		const temporary = `${target}.${crypto.randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
		renameSync(temporary, target);
	}
}
