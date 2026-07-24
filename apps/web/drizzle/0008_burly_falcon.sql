ALTER TABLE `resumes` ADD `role_key` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `target_role` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `byte_size` integer;--> statement-breakpoint
ALTER TABLE `resumes` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `resumes` ADD `source` text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_user_role_key_idx` ON `resumes` (`user_id`,`role_key`);