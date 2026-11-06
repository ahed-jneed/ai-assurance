-- Access lifecycle (#12): practice invitations keyed by email, consumed at
-- the invitee's next sign-in, and the start of each membership's current
-- grant, so client request grants issued before a revocation or role change
-- never apply again. Existing memberships keep access_since NULL, so every
-- request grant they already hold stays valid.
CREATE TABLE `invitations` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`role` text NOT NULL,
	`client_id` text,
	`engagement_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_by` text,
	`closed_at` text,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_invitations_email` ON `invitations` (`email`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invitations_pending` ON `invitations` (`tenant_id`,`email`) WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE `memberships` ADD `access_since` text;--> statement-breakpoint
-- Revocations made before this migration left the member's engagement grants,
-- sponsored runner workers and practice administration active, so a re-grant
-- restored them (F-24). Withdraw them once, as revocation now does.
UPDATE `engagement_access` SET `active`=0,`actor`='access-lifecycle-migration',`updated_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `active`=1 AND EXISTS(SELECT 1 FROM `memberships` m WHERE m.tenant_id=`engagement_access`.tenant_id AND m.user_id=`engagement_access`.user_id AND m.status<>'active');--> statement-breakpoint
UPDATE `runner_workers` SET `active`=0
WHERE `active`=1 AND NOT EXISTS(SELECT 1 FROM `memberships` m WHERE m.tenant_id=`runner_workers`.tenant_id AND m.user_id=`runner_workers`.created_by AND m.status='active' AND m.role='Lead Auditor');--> statement-breakpoint
UPDATE `practice_admins` SET `active`=0
WHERE `active`=1 AND EXISTS(SELECT 1 FROM `memberships` m WHERE m.tenant_id=`practice_admins`.tenant_id AND m.user_id=`practice_admins`.user_id AND m.status<>'active');