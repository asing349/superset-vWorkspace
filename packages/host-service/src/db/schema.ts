import type { BranchPrefixMode } from "@superset/shared/workspace-launch";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const terminalSessions = sqliteTable(
	"terminal_sessions",
	{
		id: text().primaryKey(),
		originWorkspaceId: text("origin_workspace_id").references(
			() => workspaces.id,
			{ onDelete: "set null" },
		),
		status: text().notNull().default("active"),
		// Respawn durability for workspace-LESS group/folder sessions (Wave-4 A3).
		// A `kind:"folder"` / combined-agent-root session has no `workspaces` row,
		// so after a host restart a dead PTY could only be ADOPTED, never respawned.
		// These columns persist exactly the `TerminalRootTarget` + cwd needed to
		// relaunch the same shell at the same root. NULL for normal workspace
		// sessions (which already respawn from their worktree) and harmless when
		// stale — the relaunch re-validates the path and degrades to "open a new
		// terminal" if it's gone.
		rootPath: text("root_path"),
		groupRootPathsJson: text("group_root_paths_json"),
		cwd: text(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		lastAttachedAt: integer("last_attached_at"),
		endedAt: integer("ended_at"),
	},
	(table) => [
		index("terminal_sessions_origin_workspace_id_idx").on(
			table.originWorkspaceId,
		),
		index("terminal_sessions_status_idx").on(table.status),
	],
);

export const projects = sqliteTable(
	"projects",
	{
		id: text().primaryKey(),
		repoPath: text("repo_path").notNull(),
		repoProvider: text("repo_provider"),
		repoOwner: text("repo_owner"),
		repoName: text("repo_name"),
		repoUrl: text("repo_url"),
		remoteName: text("remote_name"),
		worktreeBaseDir: text("worktree_base_dir"),
		// Per-project branch-prefix override. A null `branchPrefixMode` means
		// "fall back to the host-wide default" in `host_settings`.
		branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
		branchPrefixCustom: text("branch_prefix_custom"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [index("projects_repo_path_idx").on(table.repoPath)],
);

/**
 * Single-row host-wide settings (always `id = 1`). The host-service has no
 * generic settings store yet; this row holds host-wide knobs (worktree base
 * dir, branch-prefix default) that projects fall back to when they have no
 * override of their own.
 */
export const hostSettings = sqliteTable("host_settings", {
	id: integer().primaryKey().default(1),
	worktreeBaseDir: text("worktree_base_dir"),
	branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
	branchPrefixCustom: text("branch_prefix_custom"),
});

export const pullRequests = sqliteTable(
	"pull_requests",
	{
		id: text().primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		repoProvider: text("repo_provider").notNull(),
		repoOwner: text("repo_owner").notNull(),
		repoName: text("repo_name").notNull(),
		prNumber: integer("pr_number").notNull(),
		url: text().notNull(),
		title: text().notNull(),
		state: text().notNull(),
		isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
		headBranch: text("head_branch").notNull(),
		headSha: text("head_sha").notNull(),
		reviewDecision: text("review_decision"),
		checksStatus: text("checks_status").notNull().default("none"),
		checksJson: text("checks_json").notNull().default("[]"),
		lastFetchedAt: integer("last_fetched_at"),
		error: text(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("pull_requests_project_id_idx").on(table.projectId),
		index("pull_requests_repo_branch_idx").on(
			table.repoProvider,
			table.repoOwner,
			table.repoName,
			table.headBranch,
		),
		uniqueIndex("pull_requests_repo_pr_unique").on(
			table.repoProvider,
			table.repoOwner,
			table.repoName,
			table.prNumber,
		),
	],
);

export const hostAgentConfigs = sqliteTable(
	"host_agent_configs",
	{
		id: text().primaryKey(),
		presetId: text("preset_id").notNull(),
		label: text().notNull(),
		command: text().notNull(),
		argsJson: text("args_json").notNull().default("[]"),
		promptTransport: text("prompt_transport").notNull(),
		promptArgsJson: text("prompt_args_json").notNull().default("[]"),
		envJson: text("env_json").notNull().default("{}"),
		displayOrder: integer("display_order").notNull(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("host_agent_configs_display_order_idx").on(table.displayOrder),
	],
);

export const workspaces = sqliteTable(
	"workspaces",
	{
		id: text().primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		worktreePath: text("worktree_path").notNull(),
		branch: text().notNull(),
		headSha: text("head_sha"),
		upstreamOwner: text("upstream_owner"),
		upstreamRepo: text("upstream_repo"),
		upstreamBranch: text("upstream_branch"),
		pullRequestId: text("pull_request_id").references(() => pullRequests.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("workspaces_project_id_idx").on(table.projectId),
		index("workspaces_upstream_ref_idx").on(
			table.upstreamOwner,
			table.upstreamRepo,
			table.upstreamBranch,
		),
		index("workspaces_pull_request_id_idx").on(table.pullRequestId),
	],
);

/**
 * Multi-root workspaces ("groups"). A group is a named, ordered list of roots
 * (see `workspaceGroupRoots`). Durable host storage for what M1–M6 held in the
 * in-memory `WorkspaceGroupStore`; the SQLite-backed store reads/writes these
 * two tables. Local to one machine, like a `.code-workspace` file.
 */
export const workspaceGroups = sqliteTable("workspace_groups", {
	id: text().primaryKey(),
	name: text().notNull(),
	defaultRootId: text("default_root_id"),
	createdAt: integer("created_at")
		.notNull()
		.$defaultFn(() => Date.now()),
});

/**
 * One root per row. `id` is the `rootId` (unique within its group). When a
 * `kind: "workspace"` root's underlying worktree row is deleted, the cascade
 * removes that root; a `kind: "folder"` root has a null `workspaceId` and is
 * unaffected. `position` is the array index, re-stamped on add/remove/reorder.
 */
export const workspaceGroupRoots = sqliteTable(
	"workspace_group_roots",
	{
		id: text().primaryKey(),
		groupId: text("group_id")
			.notNull()
			.references(() => workspaceGroups.id, { onDelete: "cascade" }),
		kind: text().notNull(),
		workspaceId: text("workspace_id").references(() => workspaces.id, {
			onDelete: "cascade",
		}),
		folderPath: text("folder_path"),
		label: text().notNull(),
		position: integer().notNull(),
	},
	(t) => [index("workspace_group_roots_group_id_idx").on(t.groupId)],
);

// ---------------------------------------------------------------------------
// Superset Memory (Part B) — local-only metadata store. The on-disk Markdown
// vault and the lexical/vector index live under `~/.superset/memory/` (see
// `runtime/memory/paths.ts`); these tables hold the structured metadata. All
// structured fields are JSON-as-text (SQLite has no native array/json column).
// ---------------------------------------------------------------------------

/**
 * Episodic memory: one row per captured task (a `Playbook`). Captured
 * `provisional` at PR time (B2), `confirmed` on merge, `demoted` on
 * close-unmerged. `projectId` is nullable so an unscoped Playbook is allowed.
 * `touchedPathsJson` / `areaTagsJson` / `commandsJson` are JSON string arrays.
 */
export const memoryPlaybooks = sqliteTable(
	"memory_playbooks",
	{
		id: text().primaryKey(),
		projectId: text("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		intent: text().notNull(),
		touchedPathsJson: text("touched_paths_json").notNull().default("[]"),
		areaTagsJson: text("area_tags_json").notNull().default("[]"),
		commandsJson: text("commands_json").notNull().default("[]"),
		gotcha: text(),
		diffShape: text("diff_shape"),
		validation: text(),
		status: text().notNull().default("provisional"),
		confidence: integer().notNull().default(0),
		provenanceJson: text("provenance_json").notNull().default("{}"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("memory_playbooks_project_id_idx").on(table.projectId),
		index("memory_playbooks_status_idx").on(table.status),
		index("memory_playbooks_project_status_idx").on(
			table.projectId,
			table.status,
		),
	],
);

/**
 * Semantic memory: the lightweight per-project codebase map (B3). One row per
 * indexed path/symbol. `fingerprintId` links to `memory_fingerprints` for
 * staleness detection.
 */
export const memoryProjectIndex = sqliteTable(
	"memory_project_index",
	{
		id: text().primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		path: text().notNull(),
		kind: text().notNull().default("file"),
		areaTagsJson: text("area_tags_json").notNull().default("[]"),
		summary: text(),
		fingerprintId: text("fingerprint_id"),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("memory_project_index_project_id_idx").on(table.projectId),
		uniqueIndex("memory_project_index_project_path_unique").on(
			table.projectId,
			table.path,
		),
	],
);

/**
 * Durable Coding Practice, versioned for revert (B5). The current doc for a
 * `(scope, projectId)` is the row with the highest `version`. `projectId` is
 * null for `scope: "global"`.
 */
export const memoryPracticeVersions = sqliteTable(
	"memory_practice_versions",
	{
		id: text().primaryKey(),
		scope: text().notNull(),
		projectId: text("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		version: integer().notNull(),
		content: text().notNull(),
		provenance: text(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("memory_practice_versions_scope_project_idx").on(
			table.scope,
			table.projectId,
		),
		uniqueIndex("memory_practice_versions_scope_project_version_unique").on(
			table.scope,
			table.projectId,
			table.version,
		),
	],
);

/**
 * Content-hash + commit-SHA fingerprints for staleness detection (B3). Best
 * effort: a mismatch means "refresh", never a hard failure.
 */
export const memoryFingerprints = sqliteTable(
	"memory_fingerprints",
	{
		id: text().primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		subject: text().notNull(),
		contentHash: text("content_hash").notNull(),
		commitSha: text("commit_sha"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("memory_fingerprints_project_id_idx").on(table.projectId),
		uniqueIndex("memory_fingerprints_project_subject_unique").on(
			table.projectId,
			table.subject,
		),
	],
);

/**
 * Local token-savings / exploration telemetry (B4). `projectId` and `taskId`
 * are nullable so a global/anonymous sample is allowed.
 */
export const memoryTelemetry = sqliteTable(
	"memory_telemetry",
	{
		id: text().primaryKey(),
		projectId: text("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		taskId: text("task_id"),
		metric: text().notNull(),
		baselineValue: integer("baseline_value"),
		observedValue: integer("observed_value").notNull(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("memory_telemetry_project_id_idx").on(table.projectId),
		index("memory_telemetry_metric_idx").on(table.metric),
	],
);

// ---------------------------------------------------------------------------
// Linear ticket → autonomous PR (Wave 4, Part B) — local-only, host-side store.
// The cloud schema stays frozen (carry wave-3's local-only discipline); the
// approved ticket context is the TOP-precedence layer assembled for the
// autonomous run (developer-approved > project practice > global practice).
// ---------------------------------------------------------------------------

/**
 * The developer-approved, per-ticket context (B3) — the single human gate's
 * output. Keyed by `(projectId, taskId)`: one approved context per ticket per
 * project. `taskId` is the CLOUD `tasks.id` (Linear-synced), so it is a plain
 * text column with NO foreign key — the cloud schema is not referenced here.
 * `content` is the approved Markdown; it is redacted (secret-scrubbed) BEFORE
 * being written (redaction point #1). The store is an upsert on the unique
 * `(projectId, taskId)` pair, so re-approving replaces rather than duplicates.
 */
export const approvedTicketContext = sqliteTable(
	"approved_ticket_context",
	{
		id: text().primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// CLOUD task id (Linear-synced `tasks.id`). Intentionally NO FK — the host
		// SQLite db does not mirror the cloud `tasks` table.
		taskId: text("task_id").notNull(),
		content: text().notNull(),
		approvedBy: text("approved_by"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("approved_ticket_context_project_id_idx").on(table.projectId),
		uniqueIndex("approved_ticket_context_project_task_unique").on(
			table.projectId,
			table.taskId,
		),
	],
);

/**
 * Ticket→PR orchestrator run rows (B5) — ONE row per repo-run (a multi-repo
 * ticket fans out to N rows, all sharing `taskId`). Mirrors the cloud
 * `automation_runs` shape locally (cloud schema stays frozen): a row is inserted
 * `dispatching`, advanced to `dispatched` (with the created `workspaceId` +
 * `branch`) on success, or `failed` (with `error`) on a per-repo failure — a
 * partial multi-repo failure is recorded per-row, never a global throw.
 * `taskId`/`projectId` carry the cloud task + the host project; there is NO FK
 * on `taskId` (cloud `tasks` is not mirrored host-side). The orchestrator stops
 * at PR creation and NEVER merges.
 */
export const ticketRuns = sqliteTable(
	"ticket_runs",
	{
		id: text().primaryKey(),
		// CLOUD task id (Linear-synced `tasks.id`). No FK (cloud table not mirrored).
		taskId: text("task_id").notNull(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// 'dispatching' → 'dispatched' (success) | 'failed' (per-repo failure).
		status: text().notNull().default("dispatching"),
		workspaceId: text("workspace_id"),
		branch: text(),
		prUrl: text("pr_url"),
		error: text(),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		index("ticket_runs_task_id_idx").on(table.taskId),
		index("ticket_runs_project_id_idx").on(table.projectId),
		index("ticket_runs_status_idx").on(table.status),
	],
);
