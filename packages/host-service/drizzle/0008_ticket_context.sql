CREATE TABLE `approved_ticket_context` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`content` text NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approved_ticket_context_project_id_idx` ON `approved_ticket_context` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `approved_ticket_context_project_task_unique` ON `approved_ticket_context` (`project_id`,`task_id`);