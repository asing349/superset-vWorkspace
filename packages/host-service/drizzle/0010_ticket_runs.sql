CREATE TABLE `ticket_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'dispatching' NOT NULL,
	`workspace_id` text,
	`branch` text,
	`pr_url` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_runs_task_id_idx` ON `ticket_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `ticket_runs_project_id_idx` ON `ticket_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `ticket_runs_status_idx` ON `ticket_runs` (`status`);