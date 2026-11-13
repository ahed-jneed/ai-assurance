-- Integrity incident handling (#151). A practice administrator acknowledges
-- or resolves an incident with the handleIntegrityIncident management op,
-- which records a management event; meeting a resolved incident again
-- reopens it (recordIntegrityIncident in lib/engagement-storage.ts).
ALTER TABLE `integrity_incidents` ADD `handling` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `integrity_incidents` ADD `handled_at` text;--> statement-breakpoint
ALTER TABLE `integrity_incidents` ADD `handled_by` text;--> statement-breakpoint
CREATE TRIGGER integrity_incidents_handling_values BEFORE UPDATE OF handling ON integrity_incidents WHEN NEW.handling NOT IN ('open','acknowledged','resolved') BEGIN SELECT RAISE(ABORT, 'Unknown incident handling'); END;--> statement-breakpoint
CREATE TRIGGER integrity_incidents_handling_insert BEFORE INSERT ON integrity_incidents WHEN NEW.handling NOT IN ('open','acknowledged','resolved') BEGIN SELECT RAISE(ABORT, 'Unknown incident handling'); END;
