-- Engagement integrity incidents (#16): an engagement record found damaged
-- while loading (a D1 body that is not JSON, or an R2 part that is missing,
-- unavailable or does not match its hash), one row per engagement, object and
-- kind with a count of repeats. List endpoints isolate the engagement and
-- record it here instead of failing for every member.
CREATE TABLE `integrity_incidents` (
	`tenant_id` text NOT NULL,
	`engagement_id` text NOT NULL,
	`object_key` text NOT NULL,
	`kind` text NOT NULL,
	`status` integer NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`last_user_id` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tenant_id`, `engagement_id`, `object_key`, `kind`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
