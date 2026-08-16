import type { MailAddress } from "./domain";

export type RelationshipType =
  | "client"
  | "coworker"
  | "employer"
  | "lead"
  | "recruiter"
  | "vendor"
  | "service"
  | "personal"
  | "unknown";

export interface SenderProfile {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  domain: string;
  displayName?: string;
  messagesSeen: number;
  repliesFromUser: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  historicalImportance: number; // 0.0 to 1.0
  usuallyRequiresReply: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelationshipProfile {
  id: string;
  tenantId: string;
  userId: string;
  senderProfileId: string;
  type: RelationshipType;
  organizationId?: string;
  activeProjectIds: string[];
  importanceOverride?: number; // 0.0 to 1.0
  userDefined: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeterministicSignals {
  knownSender: boolean;
  knownRelationship: boolean;
  relationshipType?: RelationshipType;
  activeThread: boolean;
  userPreviouslyReplied: boolean;
  bulk: boolean;
  newsletter: boolean;
  automated: boolean;
  transactional: boolean;
  likelyClient: boolean;
  likelyRecruiter: boolean;
  likelyFinancial: boolean;
  likelySecurityRelated: boolean;
  explicitDeadline?: string;
  hasListUnsubscribe: boolean;
  ruleHits: string[];
}

export type ImportanceLevel = "critical" | "high" | "normal" | "low";

export type SemanticCategory =
  | "work"
  | "client"
  | "recruiter"
  | "legal"
  | "financial"
  | "security"
  | "personal"
  | "newsletter"
  | "marketing"
  | "transactional"
  | "automated"
  | "junk"
  | "other";

export type IntentType =
  | "requesting_action"
  | "asking_question"
  | "informing"
  | "confirming"
  | "selling"
  | "notifying"
  | "social"
  | "other";

export type WorkflowState =
  | "action_required"
  | "waiting_for_reply"
  | "follow_up"
  | "fyi"
  | "news"
  | "automated"
  | "junk";

export type TimeSensitivity = "immediate" | "today" | "soon" | "none";

export interface StoredClassification {
  id: string;
  tenantId: string;
  userId: string;
  emailId: string;
  threadId?: string;

  importance: ImportanceLevel;
  category: SemanticCategory;
  intent: IntentType;
  workflowState: WorkflowState;
  timeSensitivity: TimeSensitivity;

  summary: string;
  reason: string;
  confidence: number;
  deadline?: string;

  entities?: {
    people?: string[];
    organizations?: string[];
    projects?: string[];
  };

  source: "deterministic_rules" | "user_correction" | "mcp_client" | "background_ai";
  modelOrClient?: string;
  userCorrected: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type OpenLoopType =
  | "user_owes_reply"
  | "other_party_owes_reply"
  | "pending_action"
  | "pending_decision";

export interface OpenLoop {
  id: string;
  type: OpenLoopType;
  description: string;
  dueAt?: Date;
  resolved: boolean;
}

export interface ThreadState {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  providerThreadId: string;

  title?: string;
  participantEmails: string[];
  projectIds: string[];
  organizationIds: string[];

  summary?: string;
  openLoops: OpenLoop[];
  lastActivityAt: Date;
  messageCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface AttentionItem {
  messageId: string;
  threadId?: string;
  accountId: string;
  accountDisplayName: string;
  from: MailAddress;
  subject: string;
  snippet: string;
  receivedAt: string;
  importance: ImportanceLevel;
  workflowState: WorkflowState;
  timeSensitivity: TimeSensitivity;
  relationshipType?: RelationshipType;
  attentionScore: number; // 0 to 100
  reasons: string[];
  openLoops?: Array<{ type: string; description: string }>;
}

export interface InboxStatusSummary {
  accounts: Array<{
    id: string;
    displayName: string;
    provider: string;
    emailAddress: string;
    status: string;
    priorityRole: string;
    unreadCount: number;
  }>;

  totals: {
    unread: number;
    unprocessed: number;
    needsAttention: number;
    actionRequired: number;
    waitingForReply: number;
    important: number;
    routine: number;
  };

  topAttentionItems: AttentionItem[];
  accountProblems: Array<{
    accountId: string;
    displayName: string;
    error: string;
  }>;
}
