CREATE TABLE `personal_preferences` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_drafts` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`base_revision` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`, `user_id`, `kind`, `record_id`),
	FOREIGN KEY (`tenant_id`,`engagement_id`) REFERENCES `engagements`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
