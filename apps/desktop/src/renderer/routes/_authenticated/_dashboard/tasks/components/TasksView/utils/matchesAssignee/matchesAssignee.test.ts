import { describe, expect, test } from "bun:test";
import {
	ASSIGNEE_FILTER_ME,
	type CurrentUserMatcher,
	matchesAssignedToMe,
} from "./matchesAssignee";

const me: CurrentUserMatcher = {
	id: "user-1",
	email: "Ada.Lovelace@example.com",
	name: "Ada Lovelace",
};

function task(
	overrides: Partial<{
		assigneeId: string | null;
		assigneeExternalId: string | null;
		assigneeDisplayName: string | null;
	}> = {},
) {
	return {
		assigneeId: null,
		assigneeExternalId: null,
		assigneeDisplayName: null,
		...overrides,
	};
}

describe("matchesAssignedToMe", () => {
	test("sentinel value is 'me'", () => {
		expect(ASSIGNEE_FILTER_ME).toBe("me");
	});

	test("matches a task assigned directly to my Superset user id", () => {
		expect(
			matchesAssignedToMe({
				task: task({ assigneeId: "user-1" }),
				currentUser: me,
			}),
		).toBe(true);
	});

	test("does not match a task assigned to another Superset user", () => {
		expect(
			matchesAssignedToMe({
				task: task({ assigneeId: "user-2" }),
				currentUser: me,
			}),
		).toBe(false);
	});

	test("does not match an unassigned task", () => {
		expect(matchesAssignedToMe({ task: task(), currentUser: me })).toBe(false);
	});

	test("falls back to external snapshot matching my full name (case-insensitive)", () => {
		expect(
			matchesAssignedToMe({
				task: task({
					assigneeExternalId: "linear-99",
					assigneeDisplayName: "ada lovelace",
				}),
				currentUser: me,
			}),
		).toBe(true);
	});

	test("falls back to external snapshot matching my email local-part", () => {
		expect(
			matchesAssignedToMe({
				task: task({
					assigneeExternalId: "linear-99",
					assigneeDisplayName: "Ada.Lovelace",
				}),
				currentUser: me,
			}),
		).toBe(true);
	});

	test("falls back to external snapshot matching my full email", () => {
		expect(
			matchesAssignedToMe({
				task: task({
					assigneeExternalId: "linear-99",
					assigneeDisplayName: "ada.lovelace@example.com",
				}),
				currentUser: me,
			}),
		).toBe(true);
	});

	test("does not match an external assignee that is someone else", () => {
		expect(
			matchesAssignedToMe({
				task: task({
					assigneeExternalId: "linear-77",
					assigneeDisplayName: "Grace Hopper",
				}),
				currentUser: me,
			}),
		).toBe(false);
	});

	test("returns false when there is no signed-in user", () => {
		expect(
			matchesAssignedToMe({
				task: task({ assigneeId: "user-1" }),
				currentUser: null,
			}),
		).toBe(false);
	});

	test("ignores external display name when the user has no name or email", () => {
		expect(
			matchesAssignedToMe({
				task: task({
					assigneeExternalId: "linear-99",
					assigneeDisplayName: "anything",
				}),
				currentUser: { id: "user-1", email: null, name: null },
			}),
		).toBe(false);
	});
});
