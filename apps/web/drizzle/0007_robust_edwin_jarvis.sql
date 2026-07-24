CREATE TABLE `application_answer_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` text,
	`scope_key` text NOT NULL,
	`intent_key` text NOT NULL,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`answer_json` text NOT NULL,
	`auto_use` integer DEFAULT false NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_answer_memory_user_id_idx` ON `application_answer_memory` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_answer_memory_scope_intent_idx` ON `application_answer_memory` (`user_id`,`scope_key`,`intent_key`);--> statement-breakpoint
CREATE TABLE `application_interventions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`job_external_id` text NOT NULL,
	`job_url` text NOT NULL,
	`job_title` text,
	`company` text,
	`observation_fingerprint` text NOT NULL,
	`field_key` text NOT NULL,
	`field_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`deadline_at` text,
	`answer_json` text,
	`remember_scope` text,
	`auto_use` integer,
	`answered_at` text,
	`deferred_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_interventions_user_status_idx` ON `application_interventions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `application_interventions_run_id_idx` ON `application_interventions` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_interventions_observed_field_idx` ON `application_interventions` (`run_id`,`job_external_id`,`observation_fingerprint`,`field_key`);