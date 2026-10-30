CREATE TABLE `clients` (
	`id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `engagements` (
	`id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`last_command_id` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`,`client_id`) REFERENCES `clients`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engagements_client` ON `engagements` (`tenant_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`previous_hash` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`details` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`,`engagement_id`) REFERENCES `engagements`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_engagement` ON `audit_events` (`tenant_id`,`engagement_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`client_id` text,
	`display_name` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `engagement_snapshots` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`, `version`),
	FOREIGN KEY (`tenant_id`,`engagement_id`) REFERENCES `engagements`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
