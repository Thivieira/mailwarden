ALTER TABLE `oauth_codes` ADD `resource` text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`token_type` text NOT NULL,
	`client_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`resource` text,
	`parent_token_hash` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauth_tokens_hash_idx` ON `oauth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauth_tokens_tenant_user_idx` ON `oauth_tokens` (`tenant_id`,`user_id`);
