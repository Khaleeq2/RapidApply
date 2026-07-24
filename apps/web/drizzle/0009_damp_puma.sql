CREATE TABLE `ai_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`user_id` text NOT NULL,
	`field_key` text,
	`question` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`confidence_score` integer,
	`source` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_logs_user_id_idx` ON `ai_usage_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_logs_run_id_idx` ON `ai_usage_logs` (`run_id`);--> statement-breakpoint
CREATE TABLE `deferred_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`job_external_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`reason_code` text NOT NULL,
	`reason_details` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deferred_jobs_user_id_idx` ON `deferred_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `deferred_jobs_run_id_idx` ON `deferred_jobs` (`run_id`);--> statement-breakpoint
ALTER TABLE `application_runs` ADD `current_step_state` text DEFAULT 'created';--> statement-breakpoint
ALTER TABLE `application_runs` ADD `jobs_discovered_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `application_runs` ADD `jobs_attempted_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `application_runs` ADD `jobs_submitted_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `application_runs` ADD `jobs_deferred_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `autonomy_policy_json` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `daily_cap` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `hourly_cap` integer DEFAULT 5 NOT NULL;