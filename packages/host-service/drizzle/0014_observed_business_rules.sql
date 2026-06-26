CREATE TABLE `pr_review_observed_business_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`rule` text NOT NULL,
	`category` text DEFAULT 'business-logic' NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`source_pr_number` integer,
	`provenance` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pr_review_observed_business_rules_project_idx` ON `pr_review_observed_business_rules` (`project_id`);--> statement-breakpoint
CREATE INDEX `pr_review_observed_business_rules_project_state_idx` ON `pr_review_observed_business_rules` (`project_id`,`state`);--> statement-breakpoint
ALTER TABLE `pr_review_reviewer_config` ADD `business_rules_signature` text DEFAULT '' NOT NULL;