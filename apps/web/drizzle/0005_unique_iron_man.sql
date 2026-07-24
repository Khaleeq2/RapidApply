CREATE TABLE `application_answer_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`job_external_id` text NOT NULL,
	`observation_fingerprint` text NOT NULL,
	`field_key` text NOT NULL,
	`field_json` text NOT NULL,
	`plan_json` text NOT NULL,
	`decision_json` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_answer_plans_run_id_idx` ON `application_answer_plans` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_answer_plans_observation_field_idx` ON `application_answer_plans` (`run_id`,`job_external_id`,`observation_fingerprint`,`field_key`);