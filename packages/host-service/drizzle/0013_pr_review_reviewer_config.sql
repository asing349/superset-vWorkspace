CREATE TABLE `pr_review_reviewer_config` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`grounding_layers_json` text DEFAULT '[]' NOT NULL,
	`practice_project_version_id` text,
	`practice_project_version` integer,
	`practice_global_version_id` text,
	`practice_global_version` integer,
	`index_commit_sha` text,
	`index_last_indexed_at` integer,
	`index_entry_count` integer DEFAULT 0 NOT NULL,
	`settings_hash` text DEFAULT '' NOT NULL,
	`context_hash` text DEFAULT '' NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`configured_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_review_reviewer_config_project_unique` ON `pr_review_reviewer_config` (`project_id`);