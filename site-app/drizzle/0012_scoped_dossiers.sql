-- Scoped dossier exports (#83): a report keeps one full dossier per audience
-- and may add scoped internal exports, one per scope. A dossier record names
-- its scope by the SHA-256 of the scope's canonical definition (scopeSha256);
-- the full dossier, and every dossier sealed before this migration, has none.
DROP INDEX IF EXISTS `idx_dossier_audience`;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_dossier_audience ON assurance_records(tenant_id,engagement_id,json_extract(body,'$.reportId'),json_extract(body,'$.audience'),COALESCE(json_extract(body,'$.scopeSha256'),'')) WHERE kind='dossier';
