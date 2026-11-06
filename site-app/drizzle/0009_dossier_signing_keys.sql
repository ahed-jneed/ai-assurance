-- Dossier signing keys (#25, F-23). Private keys were stored as plaintext
-- PKCS#8, so anyone with D1 read access or a backup could forge dossiers and
-- briefing packets. From now on a private key is stored only wrapped under the
-- DOSSIER_KEK Worker secret (lib/signing-keys.ts). SQL cannot wrap a key, and
-- a key that sat in plaintext must be presumed exposed, so this retires every
-- existing key and erases its private half; its public half stays published
-- (GET /api/dossier/keys), so earlier dossiers and packets still verify. Each
-- practice's next seal or briefing export creates a new, wrapped key.
ALTER TABLE `dossier_keys` ADD `wrapped_key` text;--> statement-breakpoint
ALTER TABLE `dossier_keys` ADD `kek_id` text;--> statement-breakpoint
ALTER TABLE `dossier_keys` ADD `retired_at` text;--> statement-breakpoint
ALTER TABLE `dossier_keys` ADD `retired_reason` text;--> statement-breakpoint
UPDATE `dossier_keys` SET `retired_at`=strftime('%Y-%m-%dT%H:%M:%fZ','now'),`retired_reason`='Private key was stored unwrapped; retired by migration 0009 (F-23)'
WHERE `active`=1;--> statement-breakpoint
UPDATE `dossier_keys` SET `retired_reason`='Rotated before migration 0009; retirement time not recorded'
WHERE `active`<>1;--> statement-breakpoint
UPDATE `dossier_keys` SET `active`=0;--> statement-breakpoint
ALTER TABLE `dossier_keys` DROP COLUMN `private_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dossier_keys_active` ON `dossier_keys` (`tenant_id`) WHERE active = 1;
