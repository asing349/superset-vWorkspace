import { describe, expect, it } from "bun:test";
import {
	mergePullRequestsByNumber,
	PR_LIST_FILTERS,
	type PrListItem,
	searchQueriesForFilter,
} from "./pr-filters";

function pr(prNumber: number, title = `PR ${prNumber}`): PrListItem {
	return {
		prNumber,
		title,
		url: `https://example.test/pr/${prNumber}`,
		state: "open",
	};
}

describe("searchQueriesForFilter", () => {
	it("returns no qualifier for 'all' (lists every PR)", () => {
		expect(searchQueriesForFilter("all")).toEqual([]);
	});

	it("returns author:@me for 'created'", () => {
		expect(searchQueriesForFilter("created")).toEqual(["author:@me"]);
	});

	it("returns the review-requested/assignee/mentions union for 'review-requested'", () => {
		expect(searchQueriesForFilter("review-requested")).toEqual([
			"review-requested:@me",
			"assignee:@me",
			"mentions:@me",
		]);
	});

	it("uses literal @me qualifiers (resolved server-side, no login substitution)", () => {
		for (const filter of PR_LIST_FILTERS) {
			for (const query of searchQueriesForFilter(filter)) {
				expect(query).toContain("@me");
			}
		}
	});
});

describe("mergePullRequestsByNumber", () => {
	it("returns an empty list for no groups", () => {
		expect(mergePullRequestsByNumber([])).toEqual([]);
	});

	it("dedupes PRs that appear in multiple qualifier results", () => {
		const reviewRequested = [pr(1), pr(2)];
		const assignee = [pr(2), pr(3)];
		const mentions = [pr(3), pr(4)];

		const merged = mergePullRequestsByNumber([
			reviewRequested,
			assignee,
			mentions,
		]);

		expect(merged.map((p) => p.prNumber)).toEqual([1, 2, 3, 4]);
	});

	it("preserves first-seen order so the highest-priority qualifier wins on collision", () => {
		const first = [pr(7, "from review-requested")];
		const second = [pr(7, "from mentions")];

		const merged = mergePullRequestsByNumber([first, second]);

		expect(merged).toHaveLength(1);
		expect(merged[0].title).toBe("from review-requested");
	});

	it("flattens a single group unchanged", () => {
		const group = [pr(10), pr(11), pr(12)];
		expect(mergePullRequestsByNumber([group])).toEqual(group);
	});
});
