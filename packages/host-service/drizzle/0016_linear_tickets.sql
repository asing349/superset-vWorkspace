CREATE TABLE `linear_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`state_id` text,
	`state_name` text,
	`state_type` text,
	`assignee_id` text,
	`assignee_name` text,
	`assignee_email` text,
	`team_id` text,
	`team_key` text,
	`team_name` text,
	`issue_created_at` integer,
	`issue_updated_at` integer,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `linear_tickets_team_idx` ON `linear_tickets` (`team_id`);--> statement-breakpoint
CREATE INDEX `linear_tickets_updated_idx` ON `linear_tickets` (`issue_updated_at`);