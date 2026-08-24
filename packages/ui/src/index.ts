import type {
  BridgeRepairAction,
  RelayStatus,
  MailboxProvider,
  MailboxStatus,
  MembershipRole,
} from "@mailwarden/contracts";

/**
 * Mailwarden Shared Design Tokens & Visual Hierarchy
 */
export const UI_THEME = {
  colors: {
    background: "hsl(240 10% 3.9%)",
    foreground: "hsl(0 0% 98%)",
    card: "hsl(240 10% 6%)",
    cardForeground: "hsl(0 0% 98%)",
    primary: "hsl(0 0% 98%)",
    primaryForeground: "hsl(240 5.9% 10%)",
    secondary: "hsl(240 3.7% 15.9%)",
    secondaryForeground: "hsl(0 0% 98%)",
    muted: "hsl(240 3.7% 15.9%)",
    mutedForeground: "hsl(240 5% 64.9%)",
    accent: "hsl(240 3.7% 15.9%)",
    accentForeground: "hsl(0 0% 98%)",
    destructive: "hsl(0 62.8% 30.6%)",
    destructiveForeground: "hsl(0 0% 98%)",
    border: "hsl(240 3.7% 15.9%)",
    input: "hsl(240 3.7% 15.9%)",
    ring: "hsl(240 4.9% 83.9%)",
    
    // Status colors
    online: "#10b981",
    onlineBg: "rgba(16, 185, 129, 0.12)",
    onlineBorder: "rgba(16, 185, 129, 0.28)",
    
    degraded: "#f59e0b",
    degradedBg: "rgba(245, 158, 11, 0.12)",
    degradedBorder: "rgba(245, 158, 11, 0.28)",
    
    offline: "#6b7280",
    offlineBg: "rgba(107, 114, 128, 0.12)",
    offlineBorder: "rgba(107, 114, 128, 0.28)",
    
    needsAttention: "#ef4444",
    needsAttentionBg: "rgba(239, 68, 68, 0.12)",
    needsAttentionBorder: "rgba(239, 68, 68, 0.28)",
    
    provisioning: "#8b5cf6",
    provisioningBg: "rgba(139, 92, 246, 0.12)",
    provisioningBorder: "rgba(139, 92, 246, 0.28)",
    
    // Provider brand colors
    google: "#ea4335",
    microsoft: "#00a4ef",
    proton: "#6d4aff",
  },
  fonts: {
    sans: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  radius: {
    sm: "4px",
    md: "6px",
    lg: "8px",
    full: "9999px",
  }
} as const;

export interface StatusBadgeInfo {
  label: string;
  dotColor: string;
  badgeBg: string;
  badgeBorder: string;
  badgeColor: string;
  description: string;
}

/**
 * Returns human-friendly status badge attributes for any RelayStatus
 */
export function formatRelayStatusBadge(status: RelayStatus): StatusBadgeInfo {
  switch (status) {
    case "online":
      return {
        label: "Online",
        dotColor: UI_THEME.colors.online,
        badgeBg: UI_THEME.colors.onlineBg,
        badgeBorder: UI_THEME.colors.onlineBorder,
        badgeColor: "#34d399",
        description: "Relay is active and synchronizing mailboxes normally.",
      };
    case "degraded":
      return {
        label: "Degraded",
        dotColor: UI_THEME.colors.degraded,
        badgeBg: UI_THEME.colors.degradedBg,
        badgeBorder: UI_THEME.colors.degradedBorder,
        badgeColor: "#fbbf24",
        description: "Gateway is connected but Proton Bridge is reporting latency or errors.",
      };
    case "offline":
      return {
        label: "Offline",
        dotColor: UI_THEME.colors.offline,
        badgeBg: UI_THEME.colors.offlineBg,
        badgeBorder: UI_THEME.colors.offlineBorder,
        badgeColor: "#9ca3af",
        description: "Bridge device is currently unreachable or disconnected.",
      };
    case "needs_attention":
      return {
        label: "Needs Attention",
        dotColor: UI_THEME.colors.needsAttention,
        badgeBg: UI_THEME.colors.needsAttentionBg,
        badgeBorder: UI_THEME.colors.needsAttentionBorder,
        badgeColor: "#f87171",
        description: "Authentication expired or Bridge requires manual re-login.",
      };
    case "provisioning":
      return {
        label: "Pairing...",
        dotColor: UI_THEME.colors.provisioning,
        badgeBg: UI_THEME.colors.provisioningBg,
        badgeBorder: UI_THEME.colors.provisioningBorder,
        badgeColor: "#c084fc",
        description: "Device is waiting for pairing approval.",
      };
    default:
      return {
        label: "Unknown",
        dotColor: UI_THEME.colors.offline,
        badgeBg: UI_THEME.colors.offlineBg,
        badgeBorder: UI_THEME.colors.offlineBorder,
        badgeColor: "#9ca3af",
        description: "Status is being verified.",
      };
  }
}

/**
 * Returns human-friendly status badge attributes for MailboxStatus
 */
export function formatMailboxStatusBadge(status: MailboxStatus): StatusBadgeInfo {
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        dotColor: UI_THEME.colors.online,
        badgeBg: UI_THEME.colors.onlineBg,
        badgeBorder: UI_THEME.colors.onlineBorder,
        badgeColor: "#34d399",
        description: "Mailbox is actively syncing.",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        dotColor: UI_THEME.colors.offline,
        badgeBg: UI_THEME.colors.offlineBg,
        badgeBorder: UI_THEME.colors.offlineBorder,
        badgeColor: "#9ca3af",
        description: "Mailbox connection was removed.",
      };
    case "reauth_required":
      return {
        label: "Re-auth Required",
        dotColor: UI_THEME.colors.needsAttention,
        badgeBg: UI_THEME.colors.needsAttentionBg,
        badgeBorder: UI_THEME.colors.needsAttentionBorder,
        badgeColor: "#f87171",
        description: "Provider access token expired or revoked. Click Reconnect.",
      };
    case "error":
      return {
        label: "Sync Error",
        dotColor: UI_THEME.colors.degraded,
        badgeBg: UI_THEME.colors.degradedBg,
        badgeBorder: UI_THEME.colors.degradedBorder,
        badgeColor: "#fbbf24",
        description: "Temporary sync error. Retrying in background.",
      };
  }
}

/**
 * Formats membership role for display
 */
export function formatMembershipRole(role: MembershipRole): { label: string; badgeColor: string; badgeBg: string } {
  switch (role) {
    case "owner":
      return { label: "Owner", badgeColor: "#f59e0b", badgeBg: "rgba(245, 158, 11, 0.15)" };
    case "admin":
      return { label: "Admin", badgeColor: "#818cf8", badgeBg: "rgba(129, 140, 248, 0.15)" };
    case "member":
      return { label: "Member", badgeColor: "#94a3b8", badgeBg: "rgba(148, 163, 184, 0.15)" };
  }
}

/**
 * Human-First Diagnostics Map:
 * Translates low-level errors into actionable, calm human guidance with safe repair actions
 */
export interface DiagnosticItem {
  code: string;
  headline: string;
  explanation: string;
  suggestedActionLabel?: string;
  /**
   * A canonical Bridge repair action, so the UI can only ever offer something the
   * Bridge actually implements. Absent when no automatic repair applies.
   */
  suggestedActionId?: BridgeRepairAction;
  isRecoverable: boolean;
  technicalLog?: string;
}

export function mapRawErrorToDiagnostic(rawError: string | undefined): DiagnosticItem {
  if (!rawError) {
    return {
      code: "HEALTHY",
      headline: "Everything is running normally",
      explanation: "Cloud tunnel, Mailwarden Gateway, and Proton Bridge are communicating without errors.",
      isRecoverable: true,
    };
  }

  const err = rawError.toLowerCase();

  if (err.includes("econnrefused") && err.includes("1143")) {
    return {
      code: "BRIDGE_NOT_RUNNING",
      headline: "Proton Bridge is not running on the server",
      explanation: "Mailwarden can reach your server gateway, but the local Proton Bridge app is stopped or restarting.",
      // Proton owns the Proton Bridge lifecycle; Mailwarden re-checks it rather
      // than pretending it can restart someone else's application.
      suggestedActionLabel: "Check Proton Bridge again",
      suggestedActionId: "recheck_proton",
      isRecoverable: true,
      technicalLog: rawError,
    };
  }

  if (err.includes("tunnel") || err.includes("502") || err.includes("bad gateway") || err.includes("enotfound")) {
    return {
      code: "TUNNEL_DISCONNECTED",
      headline: "Cloudflare Tunnel disconnected",
      explanation: "The secure connection between Cloudflare and your Bridge server was interrupted. Check that cloudflared is running.",
      suggestedActionLabel: "Reconnect Secure Tunnel",
      suggestedActionId: "restart_tunnel",
      isRecoverable: true,
      technicalLog: rawError,
    };
  }

  if (err.includes("auth") || err.includes("invalid credentials") || err.includes("password")) {
    return {
      code: "AUTH_EXPIRED",
      headline: "Proton Bridge credentials rejected",
      explanation: "The generated 16-character Bridge password may have changed. Please verify your account details in Proton Bridge.",
      suggestedActionLabel: "Update Bridge Password",
      isRecoverable: true,
      technicalLog: rawError,
    };
  }

  if (err.includes("timeout") || err.includes("timed out")) {
    return {
      code: "SYNC_TIMEOUT",
      headline: "Synchronization timed out",
      explanation: "The Bridge server took longer than 10 seconds to respond. Mailwarden will automatically retry.",
      suggestedActionLabel: "Restart the Mailwarden gateway",
      suggestedActionId: "restart_gateway",
      isRecoverable: true,
      technicalLog: rawError,
    };
  }

  return {
    code: "GENERIC_ERROR",
    headline: "Proton Bridge reported an issue",
    explanation: rawError,
    suggestedActionLabel: "Restart the Mailwarden gateway",
    suggestedActionId: "restart_gateway",
    isRecoverable: true,
    technicalLog: rawError,
  };
}
