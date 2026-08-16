CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`client_id` text NOT NULL,
	`client_secret_hash` text,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`allowed_scopes` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_clients_client_id_idx` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_codes_code_hash_idx` ON `oauth_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `stream_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_hash` text NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stream_tickets_hash_idx` ON `stream_tickets` (`ticket_hash`);--> statement-breakpoint
ALTER TABLE `send_approvals` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `send_approvals` ADD `confirmation_nonce` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `send_approvals` ADD `confirmed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `send_approvals` ADD `confirmed_at` integer;--> statement-breakpoint
CREATE INDEX `send_approvals_status_idx` ON `send_approvals` (`status`);
