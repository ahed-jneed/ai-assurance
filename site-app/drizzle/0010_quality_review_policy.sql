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
-- Earlier grants, before the current ones. engagement_access keeps one row
-- per member and engagement and a re-grant overwrites it, so the changes
-- before the current row are rebuilt from the events that made them:
-- * a membership grant, change or accepted invitation (management_events
--   grantMember, updateMember, acceptInvitation) grants its engagementIds
--   under the role it records;
-- * a role change or revocation (updateMember, revokeMember) withdraws its
--   withdrawn.engagementIds, held under the role of the member's previous
--   grant, change or accepted invitation, or an unknown (NULL) role when no
--   earlier event records one;
-- * an engagement access change (audit_events setEngagementAccess) grants or
--   withdraws under an unknown (NULL) role; it only ever accepted Auditors,
--   Lead Auditors and Reviewers;
-- * creating an engagement from management (createEngagement) grants it to
--   its creator under an unknown (NULL) role.
-- An unknown role counts as team membership (lib/quality-review-records.ts).
-- Within one event the withdrawals come before the grants, as in its batch.
INSERT INTO `engagement_access_history`(`tenant_id`,`engagement_id`,`user_id`,`active`,`role`,`actor`,`at`)
SELECT x.tenant_id,x.engagement_id,x.user_id,x.active,x.role,x.actor,x.at FROM (
  SELECT ev.tenant_id,g.value AS engagement_id,json_extract(ev.details,'$.userId') AS user_id,1 AS active,json_extract(ev.details,'$.role') AS role,ev.actor,ev.created_at AS at,1 AS seq,ev.id AS ord
  FROM `management_events` ev, json_each(CASE WHEN json_valid(ev.details) THEN ev.details ELSE '{}' END,'$.engagementIds') g
  WHERE ev.action IN ('grantMember','updateMember','acceptInvitation')
  UNION ALL
  SELECT ev.tenant_id,w.value,json_extract(ev.details,'$.userId'),0,
    (SELECT json_extract(p.details,'$.role') FROM `management_events` p WHERE p.tenant_id=ev.tenant_id AND p.action IN ('grantMember','updateMember','acceptInvitation') AND json_valid(p.details) AND json_extract(p.details,'$.userId')=json_extract(ev.details,'$.userId') AND p.created_at<ev.created_at ORDER BY p.created_at DESC,p.id DESC LIMIT 1),
    ev.actor,ev.created_at,0,ev.id
  FROM `management_events` ev, json_each(CASE WHEN json_valid(ev.details) THEN ev.details ELSE '{}' END,'$.withdrawn.engagementIds') w
  WHERE ev.action IN ('updateMember','revokeMember')
  UNION ALL
  SELECT a.tenant_id,a.engagement_id,json_extract(a.details,'$.userId'),CASE WHEN json_extract(a.details,'$.active') THEN 1 ELSE 0 END,NULL,a.actor,a.created_at,1,a.id
  FROM `audit_events` a WHERE a.action='setEngagementAccess' AND json_valid(a.details)
  UNION ALL
  SELECT ev.tenant_id,json_extract(ev.details,'$.engagementId'),ev.actor,1,NULL,ev.actor,ev.created_at,1,ev.id
  FROM `management_events` ev WHERE ev.action='createEngagement' AND json_valid(ev.details)
) x
WHERE x.user_id IS NOT NULL AND x.engagement_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM `engagements` e WHERE e.tenant_id=x.tenant_id AND e.id=x.engagement_id)
ORDER BY x.at,x.seq,x.ord,x.engagement_id;
--> statement-breakpoint
-- Current grants, after the earlier ones. A grant held now was given under
-- the member's current role, because every role change since #12 withdraws
-- the member's grants and the Engagement Quality Reviewer role came later
-- (#24). The role a withdrawn grant was held under is not known here: it is
-- recorded as NULL, which counts as team membership up to its withdrawal.
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
