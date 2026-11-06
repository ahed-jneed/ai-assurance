-- Adopt, once, the practice access that predates engagement-level grants.
-- context() used to run these statements on every request (F-53). Practices
-- and engagements created since then write their administrator, access policy
-- and grant rows themselves. Every statement is idempotent.
-- A practice without an administrator gets its first active Lead Auditor.
INSERT OR IGNORE INTO practice_admins(tenant_id,user_id,active)
SELECT m.tenant_id,MIN(m.user_id),1 FROM memberships m
WHERE m.role='Lead Auditor' AND m.status='active'
AND NOT EXISTS(SELECT 1 FROM practice_admins a WHERE a.tenant_id=m.tenant_id)
GROUP BY m.tenant_id;
--> statement-breakpoint
-- An engagement without an access policy keeps its legacy audience: every
-- active internal member of its practice.
INSERT OR IGNORE INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at)
SELECT e.tenant_id,e.id,m.user_id,1,'legacy-access-adoption',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM engagements e JOIN memberships m ON m.tenant_id=e.tenant_id AND m.status='active' AND m.role IN ('Auditor','Lead Auditor','Reviewer')
WHERE NOT EXISTS(SELECT 1 FROM engagement_access_policies p WHERE p.tenant_id=e.tenant_id AND p.engagement_id=e.id);
--> statement-breakpoint
-- The policy row marks the engagement's access as explicitly managed, so a
-- revoked grant is never recreated.
INSERT OR IGNORE INTO engagement_access_policies(tenant_id,engagement_id,created_at)
SELECT tenant_id,id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM engagements;
