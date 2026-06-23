CREATE TABLE `memory_fingerprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`subject` text NOT NULL,
	`content_hash` text NOT NULL,
	`commit_sha` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_fingerprints_project_id_idx` ON `memory_fingerprints` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_fingerprints_project_subject_unique` ON `memory_fingerprints` (`project_id`,`subject`);--> statement-breakpoint
CREATE TABLE `memory_playbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`intent` text NOT NULL,
	`touched_paths_json` text DEFAULT '[]' NOT NULL,
	`area_tags_json` text DEFAULT '[]' NOT NULL,
	`commands_json` text DEFAULT '[]' NOT NULL,
	`gotcha` text,
	`diff_shape` text,
	`validation` text,
	`status` text DEFAULT 'provisional' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`provenance_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_playbooks_project_id_idx` ON `memory_playbooks` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_playbooks_status_idx` ON `memory_playbooks` (`status`);--> statement-breakpoint
CREATE INDEX `memory_playbooks_project_status_idx` ON `memory_playbooks` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `memory_practice_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`provenance` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_practice_versions_scope_project_idx` ON `memory_practice_versions` (`scope`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_practice_versions_scope_project_version_unique` ON `memory_practice_versions` (`scope`,`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `memory_project_index` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`area_tags_json` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`fingerprint_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_project_index_project_id_idx` ON `memory_project_index` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_project_index_project_path_unique` ON `memory_project_index` (`project_id`,`path`);--> statement-breakpoint
CREATE TABLE `memory_telemetry` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`task_id` text,
	`metric` text NOT NULL,
	`baseline_value` integer,
	`observed_value` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_telemetry_project_id_idx` ON `memory_telemetry` (`project_id`);--> statement-breakpoint
CREATE INDEX `memory_telemetry_metric_idx` ON `memory_telemetry` (`metric`);