/**
 * Mail Policy, Preset, and User Preference Types
 */

export type UserLevelClassification =
  | "junk"
  | "routine"
  | "interesting"
  | "important"
  | "critical";

export type PolicyAction =
  | "leave"
  | "archive"
  | "mark_read"
  | "keep_unread"
  | "label"
  | "move"
  | "delete"
  | "surface"
  | "prioritize";

export type PolicyScope =
  | "global"
  | "classification"
  | "account"
  | "organization"
  | "project"
  | "relationship"
  | "sender"
  | "domain"
  | "thread"
  | "message";

export type PolicyPresetName = "safe" | "balanced" | "inbox_zero" | "custom";

export interface MailPolicy {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  scope: PolicyScope;
  targetType: string;
  targetValue?: string;
  targetId?: string;
  classification?: UserLevelClassification | "any";
  action: PolicyAction;
  destination?: string;
  minimumConfidence: number; // 0 to 100
  priority: number; // higher = higher precedence
  isSystemPreset: boolean;
  presetName?: PolicyPresetName;
  enabled: boolean;
  userPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  id: string;
  tenantId: string;
  userId: string;
  onboardingCompleted: boolean;
  onboardingCompletedAt?: Date;
  preferredLanguage: string; // e.g. "en", "pt-BR"
  selectedPreset: PolicyPresetName;
  policyDryRun: boolean;
  customSettings?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyEvaluationResult {
  messageId: string;
  evaluatedClassification: UserLevelClassification;
  confidence: number; // 0.0 to 1.0
  matchedPolicy?: MailPolicy;
  precedenceLevel: number;
  precedenceName: string;
  appliedAction: PolicyAction;
  destination?: string;
  simulated: boolean;
  actionExecuted: boolean;
  reason: string;
  details: {
    sender?: string;
    relationship?: string;
    organization?: string;
    project?: string;
    account?: string;
    threadId?: string;
  };
}

export interface PolicySuggestion {
  id: string;
  tenantId: string;
  userId: string;
  suggestion: string;
  suggestedPolicy: {
    name: string;
    scope: PolicyScope;
    targetValue?: string;
    classification?: UserLevelClassification;
    action: PolicyAction;
    destination?: string;
    minimumConfidence?: number;
    userPrompt?: string;
  };
  status: "pending" | "accepted" | "dismissed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ProtonConnectorInfo {
  id: string;
  tenantId: string;
  userId: string;
  accountId: string;
  connectorType: "local_connector" | "hosted_gateway";
  deviceName: string;
  status: "online" | "offline" | "syncing" | "error";
  bridgeHost: string;
  bridgeImapPort: number;
  bridgeSmtpPort: number;
  lastSeenAt?: Date;
  errorMessage?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
