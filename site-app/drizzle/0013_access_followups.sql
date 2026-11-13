-- Access lifecycle follow-ups (#95).
--
-- 1. memberships.email: the member's normalized identity email, so revoking a
--    member cancels their pending invitations and inviteMember refuses an
--    active member. Filled from the invitations members accepted; everyone
--    else's is recorded at their next sign-in (lib/tenancy.ts).
-- 2. operator_events: the platform operator's audit trail, immutable.
-- 3. practice_erasures: a marker that exists only inside the D1 batch that
--    deletes an abandoned practice (lib/operator.ts). The append-only delete
--    triggers are recreated to admit deletes of that practice's rows while,
--    and only while, its marker exists; every other delete is still refused.
CREATE TABLE `operator_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`tenant_id` text NOT NULL,
	`details` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_operator_events_tenant` ON `operator_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_erasures` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `memberships` ADD `email` text;--> statement-breakpoint
CREATE INDEX `idx_memberships_email` ON `memberships` (`tenant_id`,`email`);--> statement-breakpoint
UPDATE `memberships` SET `email`=(SELECT i.email FROM `invitations` i WHERE i.tenant_id=memberships.tenant_id AND i.accepted_by=memberships.user_id AND i.status='accepted' ORDER BY i.closed_at DESC LIMIT 1) WHERE `email` IS NULL;
--> statement-breakpoint
CREATE TRIGGER operator_events_no_update BEFORE UPDATE ON operator_events BEGIN SELECT RAISE(ABORT, 'Operator events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER operator_events_no_delete BEFORE DELETE ON operator_events BEGIN SELECT RAISE(ABORT, 'Operator events are immutable'); END;
--> statement-breakpoint
DROP TRIGGER audit_events_no_delete;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
--> statement-breakpoint
DROP TRIGGER snapshots_no_delete;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON engagement_snapshots WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Audit snapshots are append-only'); END;
--> statement-breakpoint
DROP TRIGGER management_events_no_delete;
--> statement-breakpoint
CREATE TRIGGER management_events_no_delete BEFORE DELETE ON management_events WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Management events are immutable'); END;
--> statement-breakpoint
DROP TRIGGER assurance_records_no_delete;
--> statement-breakpoint
CREATE TRIGGER assurance_records_no_delete BEFORE DELETE ON assurance_records WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Assurance records are immutable'); END;
--> statement-breakpoint
DROP TRIGGER execution_jobs_no_delete;
--> statement-breakpoint
CREATE TRIGGER execution_jobs_no_delete BEFORE DELETE ON execution_jobs WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Execution history is retained'); END;
--> statement-breakpoint
DROP TRIGGER execution_attempts_no_delete;
--> statement-breakpoint
CREATE TRIGGER execution_attempts_no_delete BEFORE DELETE ON execution_attempts WHEN NOT EXISTS(SELECT 1 FROM execution_jobs j JOIN practice_erasures p ON p.tenant_id=j.tenant_id WHERE j.id=OLD.job_id) BEGIN SELECT RAISE(ABORT, 'Execution attempts are retained'); END;
--> statement-breakpoint
DROP TRIGGER engagement_access_history_no_delete;
--> statement-breakpoint
CREATE TRIGGER engagement_access_history_no_delete BEFORE DELETE ON engagement_access_history WHEN NOT EXISTS(SELECT 1 FROM practice_erasures p WHERE p.tenant_id=OLD.tenant_id) BEGIN SELECT RAISE(ABORT, 'Engagement access history is immutable'); END;
