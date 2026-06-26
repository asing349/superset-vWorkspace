import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import { projects } from "../../db/schema";
import {
	acceptObservedRule,
	computeBusinessRulesSignature,
	getAcceptedObservedRules,
	listObservedRules,
	proposeObservedRules,
	revertObservedRule,
	summarizeObservedRules,
} from "./business-rules-store.ts";
import type { ObservedRuleDraft } from "./business-rules-types.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");

/** Fresh in-memory db with ALL migrations — proves 0014 applies cleanly. */
function buildDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function draft(
	rule: string,
	over: Partial<ObservedRuleDraft> = {},
): ObservedRuleDraft {
	return {
		rule,
		category: "business-logic",
		confidence: 60,
		provenance: "Inferred from PR #1",
		...over,
	};
}

describe("business-rules-store (M6)", () => {
	let db: HostDb;
	const projectId = "proj-rules-1";

	beforeEach(() => {
		db = buildDb();
		db.insert(projects).values({ id: projectId, repoPath: "/tmp/r" }).run();
	});

	afterEach(() => {
		(db as unknown as { $client?: { close: () => void } }).$client?.close();
	});

	it("proposes rules as `proposed`, version 1, with provenance + source PR", () => {
		const inserted = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("Order total must never be negative")],
			sourcePrNumber: 7,
		});
		expect(inserted).toHaveLength(1);
		const rule = inserted[0];
		expect(rule?.state).toBe("proposed");
		expect(rule?.version).toBe(1);
		expect(rule?.confidence).toBe(60);
		expect(rule?.sourcePrNumber).toBe(7);
		expect(rule?.category).toBe("business-logic");

		const all = listObservedRules({ db, projectId });
		expect(all).toHaveLength(1);
		// Nothing is auto-accepted — grounding sees nothing until accept.
		expect(getAcceptedObservedRules({ db, projectId })).toHaveLength(0);
	});

	it("dedupes within a batch and against existing non-reverted rules (idempotent re-review)", () => {
		proposeObservedRules({
			db,
			projectId,
			drafts: [draft("Sessions expire after 30 days")],
			sourcePrNumber: 1,
		});
		// Re-review (or a restated rule) — same text (case/spacing-insensitive) skipped.
		const second = proposeObservedRules({
			db,
			projectId,
			drafts: [
				draft("  sessions   expire  AFTER 30 days "),
				draft("Refund window is 14 days"),
				draft("Refund window is 14 days"), // intra-batch dup
			],
			sourcePrNumber: 2,
		});
		// Only the genuinely-new rule was inserted.
		expect(second).toHaveLength(1);
		expect(second[0]?.rule).toBe("Refund window is 14 days");
		expect(listObservedRules({ db, projectId })).toHaveLength(2);
	});

	it("accept flips state to accepted, bumps version, and feeds grounding", () => {
		const [proposed] = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("Invoices are immutable once issued")],
			sourcePrNumber: 3,
		});
		const ruleId = proposed?.id ?? "";
		const accepted = acceptObservedRule({ db, projectId, ruleId });
		expect(accepted?.state).toBe("accepted");
		expect(accepted?.version).toBe(2);

		const grounded = getAcceptedObservedRules({ db, projectId });
		expect(grounded).toHaveLength(1);
		expect(grounded[0]?.id).toBe(ruleId);

		// Idempotent: accepting again does NOT bump the version further.
		const again = acceptObservedRule({ db, projectId, ruleId });
		expect(again?.version).toBe(2);
	});

	it("revert flips state to reverted, bumps version, and removes from grounding", () => {
		const [proposed] = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("Discounts cannot exceed 50%")],
			sourcePrNumber: 4,
		});
		const ruleId = proposed?.id ?? "";
		acceptObservedRule({ db, projectId, ruleId });
		const reverted = revertObservedRule({ db, projectId, ruleId });
		expect(reverted?.state).toBe("reverted");
		expect(reverted?.version).toBe(3); // proposed(1) → accepted(2) → reverted(3)
		expect(getAcceptedObservedRules({ db, projectId })).toHaveLength(0);

		// A reverted rule's text is no longer "known" → it may be re-proposed.
		const re = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("Discounts cannot exceed 50%")],
			sourcePrNumber: 5,
		});
		expect(re).toHaveLength(1);
	});

	it("accept/revert on an unknown rule id returns null (no throw)", () => {
		expect(acceptObservedRule({ db, projectId, ruleId: "ghost" })).toBeNull();
		expect(revertObservedRule({ db, projectId, ruleId: "ghost" })).toBeNull();
	});

	it("summarizes counts by state", () => {
		const inserted = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("A"), draft("B"), draft("C")],
			sourcePrNumber: 6,
		});
		acceptObservedRule({ db, projectId, ruleId: inserted[0]?.id ?? "" });
		revertObservedRule({ db, projectId, ruleId: inserted[1]?.id ?? "" });
		const summary = summarizeObservedRules({ db, projectId });
		expect(summary).toEqual({ accepted: 1, proposed: 1, reverted: 1 });
	});

	it("the accepted-rules signature is stable, order-independent, and moves on accept/revert", () => {
		const inserted = proposeObservedRules({
			db,
			projectId,
			drafts: [draft("A"), draft("B")],
			sourcePrNumber: 8,
		});
		// No accepted rules → a stable empty signature.
		const empty = computeBusinessRulesSignature(
			getAcceptedObservedRules({ db, projectId }),
		);
		expect(empty).toBe(computeBusinessRulesSignature([]));

		acceptObservedRule({ db, projectId, ruleId: inserted[0]?.id ?? "" });
		const oneAccepted = computeBusinessRulesSignature(
			getAcceptedObservedRules({ db, projectId }),
		);
		expect(oneAccepted).not.toBe(empty);

		acceptObservedRule({ db, projectId, ruleId: inserted[1]?.id ?? "" });
		const twoAccepted = computeBusinessRulesSignature(
			getAcceptedObservedRules({ db, projectId }),
		);
		expect(twoAccepted).not.toBe(oneAccepted);

		// Order independence: the signature is invariant to row order.
		const rules = getAcceptedObservedRules({ db, projectId });
		expect(computeBusinessRulesSignature(rules)).toBe(
			computeBusinessRulesSignature([...rules].reverse()),
		);

		// Reverting moves it back toward the smaller set.
		revertObservedRule({ db, projectId, ruleId: inserted[1]?.id ?? "" });
		const afterRevert = computeBusinessRulesSignature(
			getAcceptedObservedRules({ db, projectId }),
		);
		expect(afterRevert).not.toBe(twoAccepted);
	});
});
