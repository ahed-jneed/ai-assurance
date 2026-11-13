-- Review subjects (#121). An assessment's review state is decided by its
-- latest review: the review record of its kind whose assertionId, impactId or
-- obligationId names it (lib/assurance-search.ts). This index answers that as
-- one lookup per assessment, newest first, instead of a window over every
-- review of the engagement. A query must repeat the subject expression and
-- the kind list exactly for SQLite to use it.
CREATE INDEX `idx_review_subject` ON `assurance_records` (`tenant_id`,`engagement_id`,`kind`,COALESCE(json_extract(`body`,'$.assertionId'),json_extract(`body`,'$.impactId'),json_extract(`body`,'$.obligationId')),`created_at`,`id`) WHERE `kind` IN ('assertion_review','impact_review','obligation_review');
