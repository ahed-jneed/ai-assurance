CREATE TABLE `engagement_access_policies` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`)
);
--> statement-breakpoint
CREATE TABLE `assurance_records` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`actor` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`, `id`),
	FOREIGN KEY (`tenant_id`,`engagement_id`) REFERENCES `engagements`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_assurance_kind` ON `assurance_records` (`tenant_id`,`engagement_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `dossier_keys` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`private_key` text NOT NULL,
	`public_key` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `engagement_access` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`actor` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`, `user_id`),
	FOREIGN KEY (`tenant_id`,`engagement_id`) REFERENCES `engagements`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `execution_attempts` (
	`job_id` text NOT NULL,
	`fence` integer NOT NULL,
	`id` text NOT NULL,
	`worker_id` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`details` text NOT NULL,
	PRIMARY KEY(`job_id`, `fence`)
);
--> statement-breakpoint
CREATE TABLE `execution_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`state` text NOT NULL,
	`request` text NOT NULL,
	`request_sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`worker_id` text,
	`attempt_id` text,
	`fence` integer DEFAULT 0 NOT NULL,
	`nonce` text,
	`lease_until` text,
	`result_key` text,
	`result_sha256` text,
	`error` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_scope_state` ON `execution_jobs` (`tenant_id`,`engagement_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_admins` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `runner_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`image_digest` text NOT NULL,
	`capabilities` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen` text
);
--> statement-breakpoint
CREATE INDEX `idx_worker_token` ON `runner_workers` (`token_hash`);--> statement-breakpoint
CREATE TRIGGER assurance_records_no_update BEFORE UPDATE ON assurance_records BEGIN SELECT RAISE(ABORT, 'Assurance records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER assurance_records_no_delete BEFORE DELETE ON assurance_records BEGIN SELECT RAISE(ABORT, 'Assurance records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER execution_request_immutable BEFORE UPDATE OF request,request_sha256,tenant_id,engagement_id,created_by ON execution_jobs WHEN NEW.request != OLD.request OR NEW.request_sha256 != OLD.request_sha256 OR NEW.tenant_id != OLD.tenant_id OR NEW.engagement_id != OLD.engagement_id OR NEW.created_by != OLD.created_by BEGIN SELECT RAISE(ABORT, 'Execution requests are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER execution_jobs_no_delete BEFORE DELETE ON execution_jobs BEGIN SELECT RAISE(ABORT, 'Execution history is retained'); END;
--> statement-breakpoint
CREATE TRIGGER execution_terminal_immutable BEFORE UPDATE ON execution_jobs WHEN OLD.state IN ('succeeded','failed','cancelled') BEGIN SELECT RAISE(ABORT, 'Completed execution is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER execution_attempts_no_delete BEFORE DELETE ON execution_attempts BEGIN SELECT RAISE(ABORT, 'Execution attempts are retained'); END;
--> statement-breakpoint
CREATE TRIGGER execution_attempts_terminal BEFORE UPDATE ON execution_attempts WHEN OLD.state != 'running' BEGIN SELECT RAISE(ABORT, 'Completed attempts are immutable'); END;

--> statement-breakpoint
CREATE UNIQUE INDEX idx_system_revision ON assurance_records(tenant_id,engagement_id,json_extract(body,'$.name'),json_extract(body,'$.version')) WHERE kind='system';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_assessment_successor ON assurance_records(tenant_id,engagement_id,kind,json_extract(body,'$.supersedesId')) WHERE kind IN ('assertion','impact','obligation') AND json_extract(body,'$.supersedesId') IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_dossier_audience ON assurance_records(tenant_id,engagement_id,json_extract(body,'$.reportId'),json_extract(body,'$.audience')) WHERE kind='dossier';
