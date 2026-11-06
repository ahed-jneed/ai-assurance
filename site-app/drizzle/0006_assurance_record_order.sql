-- Assurance record listings page in (created_at, id) order (lib/assurance-store.ts).
-- With kind and sha256 the index also covers report pins, which read no record body.
CREATE INDEX `idx_assurance_order` ON `assurance_records` (`tenant_id`,`engagement_id`,`created_at`,`id`,`kind`,`sha256`);
