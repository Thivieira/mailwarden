CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`client_ip` text,
	`user_agent` text,
	`details` text,
	`status` text DEFAULT 'success' NOT NULL,
	`error_message` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_tenant_idx` ON `audit_events` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_events_user_idx` ON `audit_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_timestamp_idx` ON `audit_events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email_id` text NOT NULL,
	`thread_id` text,
	`importance` text DEFAULT 'normal' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`intent` text DEFAULT 'informing' NOT NULL,
	`workflow_state` text DEFAULT 'fyi' NOT NULL,
	`time_sensitivity` text DEFAULT 'none' NOT NULL,
	`summary` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` integer DEFAULT 80 NOT NULL,
	`deadline` text,
	`entities` text DEFAULT '{}',
	`source` text DEFAULT 'deterministic_rules' NOT NULL,
	`model_or_client` text,
	`user_corrected` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classifications_email_idx` ON `classifications` (`email_id`);--> statement-breakpoint
CREATE INDEX `classifications_tenant_user_idx` ON `classifications` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `classifications_importance_idx` ON `classifications` (`importance`);--> statement-breakpoint
CREATE INDEX `classifications_workflow_idx` ON `classifications` (`workflow_state`);--> statement-breakpoint
CREATE TABLE `draft_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `draft_revisions_draft_idx` ON `draft_revisions` (`draft_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`reply_to_message_id` text,
	`thread_id` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text DEFAULT '[]' NOT NULL,
	`bcc_addresses` text DEFAULT '[]' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`text_body` text DEFAULT '' NOT NULL,
	`html_body` text,
	`signature_profile_id` text,
	`rendered_signature` text,
	`attachments` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`provider_draft_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `email_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_tenant_user_idx` ON `drafts` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `drafts_account_idx` ON `drafts` (`account_id`);--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`email_address` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`priority_role` text DEFAULT 'primary_work' NOT NULL,
	`error_message` text,
	`last_synced_at` integer,
	`sync_cursor` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_accounts_tenant_user_idx` ON `email_accounts` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_accounts_tenant_email_idx` ON `email_accounts` (`tenant_id`,`email_address`);--> statement-breakpoint
CREATE TABLE `email_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`size` integer,
	`content_hash` text,
	`content_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_email_idx` ON `email_attachments` (`email_id`);--> statement-breakpoint
CREATE INDEX `attachments_tenant_user_idx` ON `email_attachments` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `email_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`can_send` integer DEFAULT true NOT NULL,
	`default_signature_profile_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_identities_tenant_user_idx` ON `email_identities` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_identities_tenant_acc_email_idx` ON `email_identities` (`tenant_id`,`account_id`,`email`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`provider_thread_id` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text DEFAULT '[]' NOT NULL,
	`bcc_addresses` text DEFAULT '[]' NOT NULL,
	`reply_to_addresses` text DEFAULT '[]',
	`subject` text DEFAULT '' NOT NULL,
	`text_body` text DEFAULT '' NOT NULL,
	`html_body` text,
	`snippet` text,
	`received_at` integer NOT NULL,
	`sent_at` integer,
	`headers` text DEFAULT '{}' NOT NULL,
	`flags` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_tenant_account_provider_msg_idx` ON `emails` (`tenant_id`,`account_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `emails_tenant_user_idx` ON `emails` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `emails_thread_idx` ON `emails` (`tenant_id`,`account_id`,`provider_thread_id`);--> statement-breakpoint
CREATE INDEX `emails_received_at_idx` ON `emails` (`received_at`);--> statement-breakpoint
CREATE INDEX `emails_from_address_idx` ON `emails` (`from_address`);--> statement-breakpoint
CREATE TABLE `mailbox_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`message_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mailbox_actions_tenant_user_idx` ON `mailbox_actions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_tenant_user_idx` ON `memberships` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_name` text NOT NULL,
	`scopes` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_token_hash_unique` ON `oauth_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_tenant_user_idx` ON `oauth_grants` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organizations_tenant_user_idx` ON `organizations` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_tenant_user_idx` ON `projects` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`key_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_conn_account_idx` ON `provider_connections` (`account_id`);--> statement-breakpoint
CREATE INDEX `provider_conn_tenant_user_idx` ON `provider_connections` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sender_profile_id` text NOT NULL,
	`type` text DEFAULT 'unknown' NOT NULL,
	`organization_id` text,
	`active_project_ids` text DEFAULT '[]' NOT NULL,
	`importance_override` integer,
	`user_defined` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_profile_id`) REFERENCES `sender_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_sender_idx` ON `relationships` (`sender_profile_id`);--> statement-breakpoint
CREATE INDEX `relationships_tenant_user_idx` ON `relationships` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `relationships_type_idx` ON `relationships` (`tenant_id`,`type`);--> statement-breakpoint
CREATE TABLE `send_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`approved_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `send_approvals_draft_idx` ON `send_approvals` (`draft_id`);--> statement-breakpoint
CREATE INDEX `send_approvals_tenant_user_idx` ON `send_approvals` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `send_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`provider_message_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_id`) REFERENCES `send_approvals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_attempts_idempotency_idx` ON `send_attempts` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `send_attempts_draft_idx` ON `send_attempts` (`draft_id`);--> statement-breakpoint
CREATE TABLE `sender_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`display_name` text,
	`messages_seen` integer DEFAULT 1 NOT NULL,
	`replies_from_user` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`historical_importance` integer DEFAULT 50 NOT NULL,
	`usually_requires_reply` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sender_profiles_tenant_email_idx` ON `sender_profiles` (`tenant_id`,`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `sender_profiles_tenant_domain_idx` ON `sender_profiles` (`tenant_id`,`user_id`,`domain`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_tenant_user_idx` ON `sessions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_token_idx` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `signature_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`title` text,
	`company` text,
	`email` text,
	`phone` text,
	`website` text,
	`plain_text` text NOT NULL,
	`html` text,
	`sign_off` text DEFAULT 'Best regards,',
	`reply_mode` text DEFAULT 'compact' NOT NULL,
	`new_message_mode` text DEFAULT 'full' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signature_profiles_tenant_user_idx` ON `signature_profiles` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `signature_profiles_user_name_idx` ON `signature_profiles` (`tenant_id`,`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `thread_states` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_thread_id` text NOT NULL,
	`title` text,
	`participant_emails` text NOT NULL,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`organization_ids` text DEFAULT '[]' NOT NULL,
	`summary` text,
	`open_loops` text DEFAULT '[]' NOT NULL,
	`message_count` integer DEFAULT 1 NOT NULL,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `email_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_states_tenant_acc_thread_idx` ON `thread_states` (`tenant_id`,`account_id`,`provider_thread_id`);--> statement-breakpoint
CREATE INDEX `thread_states_tenant_user_idx` ON `thread_states` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `thread_states_last_activity_idx` ON `thread_states` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_email_idx` ON `users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `users_tenant_idx` ON `users` (`tenant_id`);