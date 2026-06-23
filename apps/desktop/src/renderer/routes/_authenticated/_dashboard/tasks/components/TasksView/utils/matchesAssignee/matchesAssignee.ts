import type { SelectTask } from "@superset/db/schema";

/**
 * The sentinel `assigneeFilter` value for the "assigned to me" preset.
 *
 * Reuses the single `assignee` URL/store slot that already encodes `null`
 * (all), `"unassigned"`, `"ext:<id>"`, and a bare `<userId>`. The "me" preset
 * is special because it must match BOTH a directly-assigned Superset user
 * (`assigneeId === currentUser.id`) AND unmatched Linear assignees that live in
 * the external snapshot (`assigneeExternal*`).
 */
export const ASSIGNEE_FILTER_ME = "me" as const;

/** Minimal shape of the signed-in user needed to resolve the "me" preset. */
export interface CurrentUserMatcher {
	id: string;
	email: string | null | undefined;
	name: string | null | undefined;
}

/**
 * Only the assignee-related fields of a task are needed to decide membership in
 * a filter, so callers can pass any row that carries them.
 */
type TaskAssigneeFields = Pick<
	SelectTask,
	"assigneeId" | "assigneeExternalId" | "assigneeDisplayName"
>;

function normalize(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
}

function emailLocalPart(email: string | null | undefined): string | null {
	const normalized = normalize(email);
	if (!normalized) return null;
	const atIndex = normalized.indexOf("@");
	return atIndex > 0 ? normalized.slice(0, atIndex) : normalized;
}

/**
 * Email/name fallback for unmatched Linear assignees.
 *
 * The cloud schema stores no email on the external snapshot — when a Linear
 * assignee's email matches a Superset user in the org, the sync sets
 * `assigneeId` directly (covered by the primary id check), and the
 * `assigneeExternal*` snapshot is populated ONLY for unmatched users, carrying
 * just id / display name / avatar. With the schema frozen, the best available
 * read-only signal is the external display name: Linear display names commonly
 * mirror the user's full name or the local-part of their email. So we match the
 * external display name against the signed-in user's name and email local-part.
 */
function externalSnapshotMatchesCurrentUser({
	displayName,
	currentUser,
}: {
	displayName: string | null;
	currentUser: CurrentUserMatcher;
}): boolean {
	const normalizedDisplay = normalize(displayName);
	if (!normalizedDisplay) return false;

	const normalizedName = normalize(currentUser.name);
	if (normalizedName && normalizedName === normalizedDisplay) return true;

	const normalizedEmail = normalize(currentUser.email);
	if (normalizedEmail && normalizedEmail === normalizedDisplay) return true;

	const localPart = emailLocalPart(currentUser.email);
	if (localPart && localPart === normalizedDisplay) return true;

	return false;
}

/**
 * Does `task` match the "assigned to me" preset for `currentUser`?
 *
 * A task is "mine" when it is directly assigned to my Superset user
 * (`assigneeId === currentUser.id`) OR it is an unmatched Linear assignment
 * whose external snapshot resolves to me (see fallback above).
 */
export function matchesAssignedToMe({
	task,
	currentUser,
}: {
	task: TaskAssigneeFields;
	currentUser: CurrentUserMatcher | null;
}): boolean {
	if (!currentUser) return false;

	if (task.assigneeId !== null && task.assigneeId === currentUser.id) {
		return true;
	}

	if (task.assigneeExternalId !== null) {
		return externalSnapshotMatchesCurrentUser({
			displayName: task.assigneeDisplayName,
			currentUser,
		});
	}

	return false;
}
