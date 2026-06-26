import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../../db";
import * as schema from "../../../db/schema";
import { projects, prReviewReviewerConfig } from "../../../db/schema";
import {
	getReviewerConfigRow,
	proposeObservedRules,
} from "../../../runtime/pr-review/index";
import type { HostServiceContext } from "../../../types";
import { businessRulesRouter } from "./business-rules.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../../drizzle");

function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function buildCtx(db: HostDb): HostServiceContext {
	return { db, isAuthenticated: true } as unknown as HostServiceContext;
}

/** Seed an enabled reviewer config row (so we can observe the stale flip). */
function seedReviewerConfig(db: HostDb, projectId: string): void {
	db.insert(prReviewReviewerConfig)
		.values({ id: `cfg-${projectId}`, projectId, enabled: true, stale: false })
		.run();
}

describe("businessRulesRouter (M6)", () => {
	let db: HostDb;
	const projectId = "proj-br-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	function caller() {
		return businessRulesRouter.createCaller(buildCtx(db));
	}

	function seedProposed(rule: string): string {
		const [inserted] = proposeObservedRules({
			db,
			projectId,
			drafts: [
				{ rule, category: "business-logic", confidence: 50, provenance: null },
			],
			sourcePrNumber: 1,
		});
		return inserted?.id ?? "";
	}

	it("lists rules and filters by state; summary counts by state", async () => {
		const a = seedProposed("Rule A");
		seedProposed("Rule B");
		const c = caller();
		await c.accept({ projectId, ruleId: a });

		expect(await c.list({ projectId })).toHaveLength(2);
		expect(await c.list({ projectId, state: "accepted" })).toHaveLength(1);
		expect(await c.list({ projectId, state: "proposed" })).toHaveLength(1);
		expect(await c.summary({ projectId })).toEqual({
			accepted: 1,
			proposed: 1,
			reverted: 0,
		});
	});

	it("accept flips state + flags the reviewer context stale", async () => {
		seedReviewerConfig(db, projectId);
		const id = seedProposed("Accept me");
		const c = caller();
		const updated = await c.accept({ projectId, ruleId: id });
		expect(updated?.state).toBe("accepted");
		expect(getReviewerConfigRow({ db, projectId })?.stale).toBe(true);
	});

	it("revert flips state + flags the reviewer context stale", async () => {
		seedReviewerConfig(db, projectId);
		const id = seedProposed("Revert me");
		const c = caller();
		await c.accept({ projectId, ruleId: id });
		// Clear the flag the accept set, to prove revert flips it too.
		db.update(prReviewReviewerConfig)
			.set({ stale: false })
			.where(eq(prReviewReviewerConfig.projectId, projectId))
			.run();

		const reverted = await c.revert({ projectId, ruleId: id });
		expect(reverted?.state).toBe("reverted");
		expect(getReviewerConfigRow({ db, projectId })?.stale).toBe(true);
	});

	it("accept/revert on an unknown rule returns null and does not flag stale", async () => {
		seedReviewerConfig(db, projectId);
		const c = caller();
		expect(await c.accept({ projectId, ruleId: "ghost" })).toBeNull();
		expect(getReviewerConfigRow({ db, projectId })?.stale).toBe(false);
	});
});
