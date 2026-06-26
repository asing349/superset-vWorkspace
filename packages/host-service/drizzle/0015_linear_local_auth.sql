CREATE TABLE `linear_local_auth` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`expires_at` integer,
	`scope` text,
	`viewer_id` text,
	`viewer_name` text,
	`viewer_email` text,
	`workspace_id` text,
	`workspace_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
