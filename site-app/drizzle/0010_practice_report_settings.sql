-- Practice report settings (#111). The signatory, location and independence
-- and quality-management statement were typed on every report or fixed in
-- lib/domain/report-model.ts. They are now the practice's settings, as JSON,
-- set with the management op setReportSettings; a report can override each.
-- '{}' means nothing is set, so reports keep the fixed statement.
ALTER TABLE `tenants` ADD `report_settings` text DEFAULT '{}' NOT NULL;
