CREATE TABLE `pr_review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`findings_json` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pr_review_findings_project_pr_idx` ON `pr_review_findings` (`project_id`,`pr_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `pr_review_findings_project_pr_head_unique` ON `pr_review_findings` (`project_id`,`pr_number`,`head_sha`);