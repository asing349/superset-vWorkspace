CREATE TABLE `workspace_group_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`workspace_id` text,
	`folder_path` text,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `workspace_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_group_roots_group_id_idx` ON `workspace_group_roots` (`group_id`);--> statement-breakpoint
CREATE TABLE `workspace_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_root_id` text,
	`created_at` integer NOT NULL
);
