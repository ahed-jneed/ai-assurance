-- The engagement audit trail and the practice Access log (#181). Members'
-- sign-ins are recorded in sign_in_events (recordSignIn in lib/tenancy.ts),
-- never updated and deleted only with their practice; the indexes serve the
-- cursor pages of the trail and the log, newest first by (created_at, id).
CREATE TABLE `sign_in_events` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_order` ON `sign_in_events` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_sign_in_events_user` ON `sign_in_events` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_order` ON `audit_events` (`tenant_id`,`engagement_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_management_events_order` ON `management_events` (`tenant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER sign_in_events_no_update BEFORE UPDATE ON sign_in_events BEGIN SELECT RAISE(ABORT, 'Sign-in events are append-only'); END;
