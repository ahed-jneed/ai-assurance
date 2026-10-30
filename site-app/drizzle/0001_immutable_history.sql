CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON engagement_snapshots BEGIN SELECT RAISE(ABORT, 'Audit snapshots are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON engagement_snapshots BEGIN SELECT RAISE(ABORT, 'Audit snapshots are append-only'); END;
