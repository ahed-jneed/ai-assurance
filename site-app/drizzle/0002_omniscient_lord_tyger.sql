CREATE TABLE `management_events` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `memberships` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `last_command_id` text DEFAULT 'init' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER management_events_no_update BEFORE UPDATE ON management_events BEGIN SELECT RAISE(ABORT, 'Management events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER management_events_no_delete BEFORE DELETE ON management_events BEGIN SELECT RAISE(ABORT, 'Management events are immutable'); END;
