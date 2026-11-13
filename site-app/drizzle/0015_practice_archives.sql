-- Archived practices (#151, decision of 13 Nov 2026). The operator never
-- deletes a practice that released a report or signed a dossier; an abandoned
-- one is archived instead (lib/operator.ts): tenants.archived_at is set, its
-- memberships become 'archived', its pending invitations are cancelled and
-- its runner workers deactivated, while every record it issued stays.
--
-- 1. An archived practice stays archived: archived_at cannot change once set.
-- 2. Nobody regains access to it: no membership may be added to it or set
--    active again, and no invitation may be sent for it.
ALTER TABLE `tenants` ADD `archived_at` text;
--> statement-breakpoint
CREATE TRIGGER tenants_archive_final BEFORE UPDATE OF archived_at ON tenants WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT OLD.archived_at BEGIN SELECT RAISE(ABORT, 'An archived practice stays archived'); END;
--> statement-breakpoint
CREATE TRIGGER memberships_archived_no_insert BEFORE INSERT ON memberships WHEN EXISTS(SELECT 1 FROM tenants t WHERE t.id=NEW.tenant_id AND t.archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'This practice is archived'); END;
--> statement-breakpoint
CREATE TRIGGER memberships_archived_no_activate BEFORE UPDATE OF status ON memberships WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM tenants t WHERE t.id=NEW.tenant_id AND t.archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'This practice is archived'); END;
--> statement-breakpoint
CREATE TRIGGER invitations_archived_no_insert BEFORE INSERT ON invitations WHEN EXISTS(SELECT 1 FROM tenants t WHERE t.id=NEW.tenant_id AND t.archived_at IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'This practice is archived'); END;
