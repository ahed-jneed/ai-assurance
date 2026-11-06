-- Engagement quality review follow-ups (#127).
--
-- 1. engagement_access_history: every change of an engagement grant with the
--    grantee's membership role at that moment, written by triggers so every
--    grant path (memberships, invitations, setAccess, new engagements,
--    provisioning) is covered. A grant held under any role other than
--    Engagement Quality Reviewer makes its holder a team member for the
--    reviewer's eligibility (lib/quality-review-records.ts), even after it is
--    withdrawn and the member is re-granted as a reviewer. The history is
--    immutable.
-- 2. tenants.eqr_cooling_off_days: the practice's cooling-off period for
--    reviewer appointments, set through setQualityReviewPolicy; NULL applies
--    the default of 730 days. It replaces the EQR_COOLING_OFF_DAYS variable.
CREATE TABLE `engagement_access_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active` integer NOT NULL,
	`role` text,
	`actor` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_access_history_user` ON `engagement_access_history` (`tenant_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `eqr_cooling_off_days` integer;
--> statement-breakpoint
-- Existing grants. A grant held now was given under the member's current
-- role, because every role change since #12 withdraws the member's grants
-- and the Engagement Quality Reviewer role came later (#24). The role a
-- withdrawn grant was held under is not known: it is recorded as NULL, which
-- counts as team membership up to its withdrawal.
INSERT INTO `engagement_access_history`(`tenant_id`,`engagement_id`,`user_id`,`active`,`role`,`actor`,`at`)
SELECT a.tenant_id,a.engagement_id,a.user_id,a.active,
  CASE WHEN a.active=1 THEN (SELECT m.role FROM memberships m WHERE m.tenant_id=a.tenant_id AND m.user_id=a.user_id) END,
  a.actor,a.updated_at
FROM `engagement_access` a ORDER BY a.updated_at,a.tenant_id,a.engagement_id,a.user_id;
--> statement-breakpoint
CREATE TRIGGER engagement_access_history_on_insert AFTER INSERT ON engagement_access BEGIN INSERT INTO engagement_access_history(tenant_id,engagement_id,user_id,active,role,actor,at) VALUES(NEW.tenant_id,NEW.engagement_id,NEW.user_id,NEW.active,(SELECT m.role FROM memberships m WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id),NEW.actor,NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER engagement_access_history_on_update AFTER UPDATE ON engagement_access BEGIN INSERT INTO engagement_access_history(tenant_id,engagement_id,user_id,active,role,actor,at) VALUES(NEW.tenant_id,NEW.engagement_id,NEW.user_id,NEW.active,(SELECT m.role FROM memberships m WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id),NEW.actor,NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER engagement_access_history_no_update BEFORE UPDATE ON engagement_access_history BEGIN SELECT RAISE(ABORT, 'Engagement access history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER engagement_access_history_no_delete BEFORE DELETE ON engagement_access_history BEGIN SELECT RAISE(ABORT, 'Engagement access history is immutable'); END;
