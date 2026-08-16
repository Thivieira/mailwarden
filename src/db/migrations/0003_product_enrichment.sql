CREATE TABLE IF NOT EXISTS `user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`onboarding_completed_at` integer,
	`preferred_language` text DEFAULT 'en' NOT NULL,
	`selected_preset` text DEFAULT 'balanced' NOT NULL,
	`policy_dry_run` integer DEFAULT true NOT NULL,
	`custom_settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_prefs_tenant_user_idx` ON `user_preferences` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_prefs_tenant_idx` ON `user_preferences` (`tenant_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mail_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'classification' NOT NULL,
	`target_type` text DEFAULT 'classification' NOT NULL,
	`target_value` text,
	`classification` text,
	`action` text DEFAULT 'leave' NOT NULL,
	`destination` text,
	`minimum_confidence` integer DEFAULT 80 NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`is_system_preset` integer DEFAULT false NOT NULL,
	`preset_name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`user_prompt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mail_policies_tenant_user_idx` ON `mail_policies` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mail_policies_scope_idx` ON `mail_policies` (`tenant_id`,`scope`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mail_policies_enabled_idx` ON `mail_policies` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `policy_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`suggestion` text NOT NULL,
	`suggested_policy` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `policy_suggestions_tenant_user_idx` ON `policy_suggestions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `policy_suggestions_status_idx` ON `policy_suggestions` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `proton_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connector_type` text DEFAULT 'local_connector' NOT NULL,
	`device_name` text NOT NULL,
	`device_token_hash` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`bridge_host` text DEFAULT '127.0.0.1' NOT NULL,
	`bridge_imap_port` integer DEFAULT 1143 NOT NULL,
	`bridge_smtp_port` integer DEFAULT 1025 NOT NULL,
	`last_seen_at` integer,
	`error_message` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `proton_connectors_tenant_user_idx` ON `proton_connectors` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `proton_connectors_account_idx` ON `proton_connectors` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `proton_connectors_token_idx` ON `proton_connectors` (`device_token_hash`);
