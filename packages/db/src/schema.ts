import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ==========================================
// TENANTS & USERS
// ==========================================

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: text("kind", { enum: ["personal", "team"] }).notNull().default("personal"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    plan: text("plan", { enum: ["personal", "team", "enterprise"] }).notNull().default("personal"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  }
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_tenant_email_idx").on(table.tenantId, table.email),
    index("users_tenant_idx").on(table.tenantId),
  ]
);

export const identityEmailClaims = sqliteTable(
  "identity_email_claims",
  {
    email: text("email").primaryKey(),
    userId: text("user_id").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  }
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("sessions_tenant_user_idx").on(table.tenantId, table.userId),
    index("sessions_token_idx").on(table.tokenHash),
  ]
);

export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().unique(),
    clientSecretHash: text("client_secret_hash"),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris", { mode: "json" }).notNull().$type<string[]>(),
    allowedScopes: text("allowed_scopes", { mode: "json" }).notNull().$type<string[]>(),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("oauth_clients_client_id_idx").on(table.clientId),
  ]
);

export const oauthCodes = sqliteTable(
  "oauth_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
    resource: text("resource"),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("oauth_codes_code_hash_idx").on(table.codeHash),
  ]
);

export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenType: text("token_type", { enum: ["access_token", "refresh_token"] }).notNull(),
    clientId: text("client_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
    resource: text("resource"),
    parentTokenHash: text("parent_token_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("oauth_tokens_hash_idx").on(table.tokenHash),
    index("oauth_tokens_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

export const streamTickets = sqliteTable(
  "stream_tickets",
  {
    id: text("id").primaryKey(),
    ticketHash: text("ticket_hash").notNull().unique(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("stream_tickets_hash_idx").on(table.ticketHash),
  ]
);

// ==========================================
// EMAIL ACCOUNTS & IDENTITIES
// ==========================================

export const emailAccounts = sqliteTable(
  "email_accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["gmail", "outlook", "proton", "imap", "mock"] }).notNull(),
    displayName: text("display_name").notNull(),
    emailAddress: text("email_address").notNull(),
    status: text("status", { enum: ["connected", "disconnected", "error", "reauth_required"] })
      .notNull()
      .default("connected"),
    priorityRole: text("priority_role", {
      enum: ["primary_work", "personal", "freelance", "entertainment", "low_priority"],
    })
      .notNull()
      .default("primary_work"),
    errorMessage: text("error_message"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
    syncCursor: text("sync_cursor"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("email_accounts_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("email_accounts_tenant_email_idx").on(table.tenantId, table.emailAddress),
  ]
);

export const emailIdentities = sqliteTable(
  "email_identities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    canSend: integer("can_send", { mode: "boolean" }).notNull().default(true),
    defaultSignatureProfileId: text("default_signature_profile_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("email_identities_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("email_identities_tenant_acc_email_idx").on(table.tenantId, table.accountId, table.email),
  ]
);

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["gmail", "outlook", "proton", "imap", "mock"] }).notNull(),
    encryptedCredentials: text("encrypted_credentials", { mode: "json" }).notNull(),
    keyVersion: text("key_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("provider_conn_account_idx").on(table.accountId),
    index("provider_conn_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

// ==========================================
// EMAILS & ATTACHMENTS
// ==========================================

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),

    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),

    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),

    toAddresses: text("to_addresses", { mode: "json" }).notNull().$type<Array<{ name?: string; address: string }>>(),
    ccAddresses: text("cc_addresses", { mode: "json" }).notNull().default("[]").$type<Array<{ name?: string; address: string }>>(),
    bccAddresses: text("bcc_addresses", { mode: "json" }).notNull().default("[]").$type<Array<{ name?: string; address: string }>>(),
    replyToAddresses: text("reply_to_addresses", { mode: "json" }).default("[]").$type<Array<{ name?: string; address: string }>>(),

    subject: text("subject").notNull().default(""),
    textBody: text("text_body").notNull().default(""),
    htmlBody: text("html_body"),
    snippet: text("snippet"),

    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),

    headers: text("headers", { mode: "json" }).notNull().default("{}").$type<Record<string, string>>(),
    flags: text("flags", { mode: "json" }).notNull().$type<{
      unread: boolean;
      starred?: boolean;
      draft?: boolean;
      archived?: boolean;
      bulk: boolean;
      automated: boolean;
      hasListUnsubscribe: boolean;
      transactional?: boolean;
    }>(),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("emails_tenant_account_provider_msg_idx").on(table.tenantId, table.accountId, table.providerMessageId),
    index("emails_tenant_user_idx").on(table.tenantId, table.userId),
    index("emails_thread_idx").on(table.tenantId, table.accountId, table.providerThreadId),
    index("emails_received_at_idx").on(table.receivedAt),
    index("emails_from_address_idx").on(table.fromAddress),
  ]
);

export const emailAttachments = sqliteTable(
  "email_attachments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    contentHash: text("content_hash"),
    contentUrl: text("content_url"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("attachments_email_idx").on(table.emailId),
    index("attachments_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

// ==========================================
// THREAD INTELLIGENCE & SENDER PROFILES
// ==========================================

export const threadStates = sqliteTable(
  "thread_states",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    providerThreadId: text("provider_thread_id").notNull(),

    title: text("title"),
    participantEmails: text("participant_emails", { mode: "json" }).notNull().$type<string[]>(),
    projectIds: text("project_ids", { mode: "json" }).notNull().default("[]").$type<string[]>(),
    organizationIds: text("organization_ids", { mode: "json" }).notNull().default("[]").$type<string[]>(),

    summary: text("summary"),
    openLoops: text("open_loops", { mode: "json" }).notNull().default("[]").$type<Array<{
      id: string;
      type: "user_owes_reply" | "other_party_owes_reply" | "pending_action" | "pending_decision";
      description: string;
      dueAt?: string;
      resolved: boolean;
    }>>(),

    messageCount: integer("message_count").notNull().default(1),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp" }).notNull(),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("thread_states_tenant_acc_thread_idx").on(table.tenantId, table.accountId, table.providerThreadId),
    index("thread_states_tenant_user_idx").on(table.tenantId, table.userId),
    index("thread_states_last_activity_idx").on(table.lastActivityAt),
  ]
);

export const senderProfiles = sqliteTable(
  "sender_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    domain: text("domain").notNull(),
    displayName: text("display_name"),

    messagesSeen: integer("messages_seen").notNull().default(1),
    repliesFromUser: integer("replies_from_user").notNull().default(0),

    firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),

    historicalImportance: integer("historical_importance").notNull().default(50), // 0 to 100
    usuallyRequiresReply: integer("usually_requires_reply", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("sender_profiles_tenant_email_idx").on(table.tenantId, table.userId, table.email),
    index("sender_profiles_tenant_domain_idx").on(table.tenantId, table.userId, table.domain),
  ]
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderProfileId: text("sender_profile_id")
      .notNull()
      .references(() => senderProfiles.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["client", "coworker", "employer", "lead", "recruiter", "vendor", "service", "personal", "unknown"],
    })
      .notNull()
      .default("unknown"),
    organizationId: text("organization_id"),
    activeProjectIds: text("active_project_ids", { mode: "json" }).notNull().default("[]").$type<string[]>(),
    importanceOverride: integer("importance_override"), // 0 to 100
    userDefined: integer("user_defined", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("relationships_sender_idx").on(table.senderProfileId),
    index("relationships_tenant_user_idx").on(table.tenantId, table.userId),
    index("relationships_type_idx").on(table.tenantId, table.type),
  ]
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("organizations_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived", "planned"] }).notNull().default("active"),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("projects_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

export const userServices = sqliteTable(
  "user_services",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider"),
    environment: text("environment", { enum: ["production", "staging", "development", "other"] }).notNull().default("other"),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    domains: text("domains", { mode: "json" }).notNull().default("[]").$type<string[]>(),
    accountIds: text("account_ids", { mode: "json" }).notNull().default("[]").$type<string[]>(),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("user_services_name_idx").on(table.tenantId, table.userId, table.name),
    index("user_services_status_idx").on(table.tenantId, table.userId, table.status),
  ]
);

export const userCommitments = sqliteTable(
  "user_commitments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["subscription", "payment", "deadline", "contract", "other"] }).notNull(),
    name: text("name").notNull(),
    counterparty: text("counterparty"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    dueAt: integer("due_at", { mode: "timestamp" }),
    status: text("status", { enum: ["active", "fulfilled", "cancelled"] }).notNull().default("active"),
    relatedServiceId: text("related_service_id").references(() => userServices.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("user_commitments_status_idx").on(table.tenantId, table.userId, table.status),
    index("user_commitments_due_idx").on(table.tenantId, table.userId, table.dueAt),
    index("user_commitments_service_idx").on(table.relatedServiceId),
  ]
);

// ==========================================
// CLASSIFICATIONS
// ==========================================

export const classifications = sqliteTable(
  "classifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    threadId: text("thread_id"),

    importance: text("importance", { enum: ["critical", "high", "normal", "low"] }).notNull().default("normal"),
    category: text("category").notNull().default("other"),
    intent: text("intent").notNull().default("informing"),
    workflowState: text("workflow_state", {
      enum: ["action_required", "waiting_for_reply", "follow_up", "fyi", "news", "automated", "junk"],
    })
      .notNull()
      .default("fyi"),
    timeSensitivity: text("time_sensitivity", { enum: ["immediate", "today", "soon", "none"] })
      .notNull()
      .default("none"),

    summary: text("summary").notNull(),
    reason: text("reason").notNull(),
    confidence: integer("confidence").notNull().default(80), // 0 to 100
    deadline: text("deadline"),

    entities: text("entities", { mode: "json" }).default("{}").$type<{
      people?: string[];
      organizations?: string[];
      projects?: string[];
    }>(),

    source: text("source", {
      enum: ["deterministic_rules", "user_correction", "mcp_client", "background_ai"],
    })
      .notNull()
      .default("deterministic_rules"),
    modelOrClient: text("model_or_client"),
    userCorrected: integer("user_corrected", { mode: "boolean" }).notNull().default(false),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("classifications_email_idx").on(table.emailId),
    index("classifications_tenant_user_idx").on(table.tenantId, table.userId),
    index("classifications_importance_idx").on(table.importance),
    index("classifications_workflow_idx").on(table.workflowState),
  ]
);

// ==========================================
// INBOX INTELLIGENCE EVENTS
// ==========================================

export const messageFacts = sqliteTable(
  "message_facts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
    featureVersion: text("feature_version").notNull(),
    facts: text("facts", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    contentHash: text("content_hash").notNull(),
    rfcMessageId: text("rfc_message_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("message_facts_email_idx").on(table.emailId),
    index("message_facts_tenant_user_idx").on(table.tenantId, table.userId),
    index("message_facts_content_hash_idx").on(table.tenantId, table.userId, table.contentHash),
  ]
);

export const triageEvents = sqliteTable(
  "triage_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventKey: text("event_key").notNull(),
    normalizedSubject: text("normalized_subject").notNull().default(""),
    observedState: text("observed_state", { enum: ["active", "resolved"] }).notNull().default("active"),
    messageCount: integer("message_count").notNull().default(1),
    firstObservedAt: integer("first_observed_at", { mode: "timestamp" }).notNull(),
    lastObservedAt: integer("last_observed_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("triage_events_tenant_user_idx").on(table.tenantId, table.userId),
    index("triage_events_status_idx").on(table.tenantId, table.userId, table.observedState),
    index("triage_events_last_observed_idx").on(table.lastObservedAt),
  ]
);

export const triageEventKeys = sqliteTable(
  "triage_event_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => triageEvents.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["exact", "thread", "typed", "fallback"] }).notNull(),
    value: text("value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("triage_event_keys_identity_idx").on(table.tenantId, table.userId, table.value),
    index("triage_event_keys_event_idx").on(table.eventId),
  ]
);

export const triageEventMembers = sqliteTable(
  "triage_event_members",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => triageEvents.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull().references(() => emails.id, { onDelete: "cascade" }),
    membershipReason: text("membership_reason", { enum: ["exact", "thread", "typed", "fallback"] }).notNull(),
    supersededByEmailId: text("superseded_by_email_id").references(() => emails.id, { onDelete: "set null" }),
    observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("triage_event_members_email_idx").on(table.emailId),
    index("triage_event_members_event_idx").on(table.eventId, table.observedAt),
    index("triage_event_members_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

export const triageDecisions = sqliteTable(
  "triage_decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => triageEvents.id, { onDelete: "cascade" }),
    protocolVersion: text("protocol_version").notNull(),
    factsVersion: text("facts_version").notNull(),
    uocVersion: text("uoc_version").notNull().default("0"),
    judgmentSource: text("judgment_source", { enum: ["external_agent", "user_correction"] }).notNull(),
    externalJudgment: text("external_judgment", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    validatedJudgment: text("validated_judgment", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    clampsApplied: text("clamps_applied", { mode: "json" }).notNull().default("[]").$type<Array<Record<string, unknown>>>(),
    derivedBand: text("derived_band", { enum: ["P0", "P1", "P2", "P3", "noise"] }).notNull(),
    derivedUrgency: text("derived_urgency").notNull(),
    lane: text("lane", { enum: ["action", "briefing", "record", "suppressed"] }).notNull(),
    inconsistent: integer("inconsistent", { mode: "boolean" }).notNull().default(false),
    safeActionTarget: integer("safe_action_target", { mode: "boolean" }).notNull().default(true),
    reviewFlags: text("review_flags", { mode: "json" }).notNull().default("[]").$type<string[]>(),
    needsReevaluation: integer("needs_reevaluation", { mode: "boolean" }).notNull().default(false),
    previousDecisionId: text("previous_decision_id"),
    correctionState: text("correction_state", { enum: ["none", "corrected"] }).notNull().default("none"),
    correctionReason: text("correction_reason"),
    clientMetadata: text("client_metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("triage_decisions_event_idx").on(table.eventId, table.createdAt),
    index("triage_decisions_tenant_user_idx").on(table.tenantId, table.userId),
    index("triage_decisions_stale_idx").on(table.tenantId, table.userId, table.needsReevaluation),
    index("triage_decisions_band_idx").on(table.tenantId, table.userId, table.derivedBand),
  ]
);

// ==========================================
// SIGNATURES & DRAFTS
// ==========================================

export const signatureProfiles = sqliteTable(
  "signature_profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g. 'consulting', 'personal', 'work', 'minimal'
    displayName: text("display_name").notNull(),
    title: text("title"),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    plainText: text("plain_text").notNull(),
    html: text("html"),
    signOff: text("sign_off").default("Best regards,"),
    replyMode: text("reply_mode", { enum: ["full", "compact", "none"] }).notNull().default("compact"),
    newMessageMode: text("new_message_mode", { enum: ["full", "compact", "none"] }).notNull().default("full"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("signature_profiles_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("signature_profiles_user_name_idx").on(table.tenantId, table.userId, table.name),
  ]
);

export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    identityId: text("identity_id")
      .notNull()
      .references(() => emailIdentities.id, { onDelete: "cascade" }),

    replyToMessageId: text("reply_to_message_id"),
    threadId: text("thread_id"),

    toAddresses: text("to_addresses", { mode: "json" }).notNull().$type<Array<{ name?: string; address: string }>>(),
    ccAddresses: text("cc_addresses", { mode: "json" }).notNull().default("[]").$type<Array<{ name?: string; address: string }>>(),
    bccAddresses: text("bcc_addresses", { mode: "json" }).notNull().default("[]").$type<Array<{ name?: string; address: string }>>(),

    subject: text("subject").notNull().default(""),
    textBody: text("text_body").notNull().default(""),
    htmlBody: text("html_body"),

    signatureProfileId: text("signature_profile_id"),
    renderedSignature: text("rendered_signature"),

    attachments: text("attachments", { mode: "json" }).notNull().default("[]").$type<Array<{
      filename: string;
      contentType?: string;
      size?: number;
      contentHash?: string;
      dataBase64?: string;
    }>>(),

    status: text("status", { enum: ["draft", "approved", "sent", "failed"] }).notNull().default("draft"),
    providerDraftId: text("provider_draft_id"),
    revision: integer("revision").notNull().default(1),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("drafts_tenant_user_idx").on(table.tenantId, table.userId),
    index("drafts_account_idx").on(table.accountId),
  ]
);

export const draftRevisions = sqliteTable(
  "draft_revisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("draft_revisions_draft_idx").on(table.draftId),
  ]
);

// ==========================================
// SEND APPROVALS & ATTEMPTS (SEND GUARD)
// ==========================================

export const sendApprovals = sqliteTable(
  "send_approvals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["pending", "confirmed", "rejected"] }).notNull().default("pending"),
    confirmationNonce: text("confirmation_nonce").notNull(),
    confirmedByUserId: text("confirmed_by_user_id"),
    approvedAt: integer("approved_at", { mode: "timestamp" }).notNull(),
    confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("send_approvals_draft_idx").on(table.draftId),
    index("send_approvals_tenant_user_idx").on(table.tenantId, table.userId),
    index("send_approvals_status_idx").on(table.status),
  ]
);

export const sendAttempts = sqliteTable(
  "send_attempts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    approvalId: text("approval_id")
      .notNull()
      .references(() => sendApprovals.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["in_progress", "sent", "failed"] }).notNull().default("in_progress"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("send_attempts_idempotency_idx").on(table.tenantId, table.idempotencyKey),
    index("send_attempts_draft_idx").on(table.draftId),
  ]
);

export const mailboxActions = sqliteTable(
  "mailbox_actions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    action: text("action", { enum: ["mark_read", "mark_unread", "archive"] }).notNull(),
    status: text("status", { enum: ["success", "simulated", "failed"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("mailbox_actions_tenant_user_idx").on(table.tenantId, table.userId),
  ]
);

// ==========================================
// AUDIT LOGS
// ==========================================

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    clientIp: text("client_ip"),
    userAgent: text("user_agent"),
    details: text("details", { mode: "json" }),
    status: text("status", { enum: ["success", "failure", "simulated"] }).notNull().default("success"),
    errorMessage: text("error_message"),
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("audit_events_tenant_idx").on(table.tenantId),
    index("audit_events_user_idx").on(table.userId),
    index("audit_events_action_idx").on(table.action),
    index("audit_events_timestamp_idx").on(table.timestamp),
  ]
);

// ==========================================
// USER PREFERENCES & ONBOARDING
// ==========================================

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    onboardingCompleted: integer("onboarding_completed", { mode: "boolean" }).notNull().default(false),
    onboardingCompletedAt: integer("onboarding_completed_at", { mode: "timestamp" }),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    selectedPreset: text("selected_preset", {
      enum: ["safe", "balanced", "inbox_zero", "custom"],
    })
      .notNull()
      .default("balanced"),
    policyDryRun: integer("policy_dry_run", { mode: "boolean" }).notNull().default(true),
    customSettings: text("custom_settings", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("user_prefs_tenant_user_idx").on(table.tenantId, table.userId),
    index("user_prefs_tenant_idx").on(table.tenantId),
  ]
);

// ==========================================
// MAIL POLICIES (SEPARATE FROM CLASSIFICATIONS)
// ==========================================

export const mailPolicies = sqliteTable(
  "mail_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scope: text("scope", {
      enum: [
        "global",
        "classification",
        "account",
        "organization",
        "project",
        "relationship",
        "sender",
        "domain",
        "thread",
        "message",
      ],
    })
      .notNull()
      .default("classification"),
    targetType: text("target_type").notNull().default("classification"),
    targetValue: text("target_value"),
    classification: text("classification", {
      enum: ["junk", "routine", "interesting", "important", "critical", "any"],
    }),
    action: text("action", {
      enum: [
        "leave",
        "archive",
        "mark_read",
        "keep_unread",
        "label",
        "move",
        "delete",
        "surface",
        "prioritize",
      ],
    })
      .notNull()
      .default("leave"),
    destination: text("destination"),
    minimumConfidence: integer("minimum_confidence").notNull().default(80),
    priority: integer("priority").notNull().default(50),
    isSystemPreset: integer("is_system_preset", { mode: "boolean" }).notNull().default(false),
    presetName: text("preset_name"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    userPrompt: text("user_prompt"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("mail_policies_tenant_user_idx").on(table.tenantId, table.userId),
    index("mail_policies_scope_idx").on(table.tenantId, table.scope),
    index("mail_policies_enabled_idx").on(table.tenantId, table.enabled),
  ]
);

// ==========================================
// POLICY SUGGESTIONS (LEARNED AUTOMATIONS)
// ==========================================

export const policySuggestions = sqliteTable(
  "policy_suggestions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    suggestion: text("suggestion").notNull(),
    suggestedPolicy: text("suggested_policy", { mode: "json" }).notNull(),
    status: text("status", { enum: ["pending", "accepted", "dismissed"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("policy_suggestions_tenant_user_idx").on(table.tenantId, table.userId),
    index("policy_suggestions_status_idx").on(table.status),
  ]
);

// ==========================================
// PROTON CONNECTORS (LOCAL CONNECTOR / HOSTED GATEWAY)
// ==========================================

export const protonConnectors = sqliteTable(
  "proton_connectors",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    connectorType: text("connector_type", {
      enum: ["local_connector", "hosted_gateway"],
    })
      .notNull()
      .default("local_connector"),
    deviceName: text("device_name").notNull(),
    deviceTokenHash: text("device_token_hash").notNull().unique(),
    status: text("status", { enum: ["online", "offline", "syncing", "error"] })
      .notNull()
      .default("offline"),
    bridgeHost: text("bridge_host").notNull().default("127.0.0.1"),
    bridgeImapPort: integer("bridge_imap_port").notNull().default(1143),
    bridgeSmtpPort: integer("bridge_smtp_port").notNull().default(1025),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    errorMessage: text("error_message"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("proton_connectors_tenant_user_idx").on(table.tenantId, table.userId),
    uniqueIndex("proton_connectors_account_idx").on(table.tenantId, table.accountId),
    index("proton_connectors_token_idx").on(table.deviceTokenHash),
  ]
);

// ==========================================
// ORGANIZATION INVITES
// ==========================================

export const organizationInvites = sqliteTable(
  "organization_invites",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email"),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("organization_invites_tenant_idx").on(table.tenantId),
    index("organization_invites_email_idx").on(table.email),
    index("organization_invites_expires_idx").on(table.expiresAt),
  ]
);

// ==========================================
// RELAY DEVICES & PROVISIONING
// ==========================================

export const relayDevices = sqliteTable(
  "relay_devices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    version: text("version").notNull(),
    protocolVersion: integer("protocol_version").notNull().default(1),
    status: text("status", {
      enum: ["provisioning", "online", "degraded", "offline", "needs_attention"],
    }).notNull().default("provisioning"),
    capabilities: text("capabilities", { mode: "json" }).notNull().$type<Record<string, boolean>>(),
    lastHealth: text("last_health", { mode: "json" }).$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    /**
     * Managed Cloudflare Tunnel for this device. The run token is never stored:
     * it is fetched from Cloudflare when the device asks for it.
     */
    tunnelId: text("tunnel_id"),
    tunnelHostname: text("tunnel_hostname"),
    tunnelProvisionedAt: integer("tunnel_provisioned_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("relay_devices_tenant_idx").on(table.tenantId),
    index("relay_devices_status_idx").on(table.tenantId, table.status),
  ]
);

export const relayProvisioningSessions = sqliteTable(
  "relay_provisioning_sessions",
  {
    id: text("id").primaryKey(),
    deviceCodeHash: text("device_code_hash").notNull().unique(),
    userCodeHash: text("user_code_hash").notNull().unique(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull(),
    platform: text("platform").notNull(),
    version: text("version").notNull(),
    protocolVersion: integer("protocol_version").notNull().default(1),
    capabilities: text("capabilities", { mode: "json" }).notNull().$type<Record<string, boolean>>(),
    state: text("state", { enum: ["pending", "authorized", "denied", "expired"] }).notNull().default("pending"),
    authorizedByUserId: text("authorized_by_user_id").references(() => users.id, { onDelete: "set null" }),
    relayDeviceId: text("relay_device_id").references(() => relayDevices.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    authorizedAt: integer("authorized_at", { mode: "timestamp" }),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("relay_provisioning_tenant_idx").on(table.tenantId),
    index("relay_provisioning_expires_idx").on(table.expiresAt),
  ]
);

export const relayDeviceCredentials = sqliteTable(
  "relay_device_credentials",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => relayDevices.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull().default(1),
    deviceSecretHash: text("device_secret_hash").notNull().unique(),
    encryptedGatewaySecret: text("encrypted_gateway_secret", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("relay_credentials_device_idx").on(table.deviceId),
    index("relay_credentials_tenant_idx").on(table.tenantId),
  ]
);

// ==========================================
// PRIVATE BETA INVITES
// ==========================================

/**
 * Managed tunnel resources awaiting release.
 *
 * Local revocation is authoritative even when Cloudflare cannot be reached, so
 * the orphaned tunnel is recorded here and retried rather than leaked.
 */
export const relayTunnelCleanup = sqliteTable(
  "relay_tunnel_cleanup",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    deviceId: text("device_id").notNull(),
    tunnelId: text("tunnel_id").notNull(),
    hostname: text("hostname"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    releasedAt: integer("released_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("relay_tunnel_cleanup_tunnel_idx").on(table.tunnelId),
    index("relay_tunnel_cleanup_pending_idx").on(table.releasedAt, table.lastAttemptAt),
  ]
);

export const betaInvites = sqliteTable(
  "beta_invites",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    email: text("email"),
    createdByUserId: text("created_by_user_id"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    usedByUserId: text("used_by_user_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("beta_invites_code_idx").on(table.code),
    index("beta_invites_email_idx").on(table.email),
  ]
);
