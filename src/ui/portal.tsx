import { Alert, Record, SiteHeader } from "./parts";
import {
  UI_THEME,
  formatRelayStatusBadge,
  formatMailboxStatusBadge,
  formatMembershipRole,
  type DiagnosticItem,
} from "@mailwarden/ui";
import type { RelayDevice } from "@mailwarden/contracts";

export interface PortalDashboardPageProps {
  host: string;
  user: {
    displayName: string;
    email: string;
    tenantId: string;
    role: string;
  };
  token: string;
  activeWorkspace: {
    id: string;
    name: string;
    kind: "personal" | "team";
    role: "owner" | "admin" | "member";
  };
  workspaces: Array<{
    id: string;
    name: string;
    kind: "personal" | "team";
  }>;
  currentTab?: "overview" | "members" | "mailboxes" | "relay" | "devices" | "plan";
  accounts: Array<{
    id: string;
    provider: string;
    emailAddress: string;
    displayName: string;
    status: string;
    priorityRole?: string;
  }>;
  googleAuthUrl?: string;
  microsoftAuthUrl?: string;
  dryRun?: boolean;
  invites?: any[];
  createdInviteUrl?: string;
  connectedMessage?: string;
  disconnectedMessage?: string;

  // Organization-specific props
  members?: Array<{
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role: "owner" | "admin" | "member";
    joinedAt: Date | string;
    isSelf?: boolean;
  }>;
  orgInvites?: Array<{
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  }>;
  relayStatus?: {
    status: "online" | "degraded" | "offline" | "needs_attention" | "provisioning";
    endpointUrl?: string;
    connectedAccountsCount: number;
    activeDevicesCount: number;
    lastSeenAt?: string;
    errorMessage?: string;
  };
  relayDevices?: RelayDevice[];
  planCapabilities?: {
    canCreateOrganization: boolean;
    maxOrganizationSeats: number;
    maxRelayDevices: number;
    sharedProtonRelay: boolean;
  };
  createdOrgInviteUrl?: string;
  diagnostics?: DiagnosticItem;
}

export function PortalLandingPage(props: {
  host: string;
  error?: string;
  success?: string;
  mode?: "login" | "signup";
  inviteCode?: string;
  isPrivateBeta?: boolean;
  loggedInUser?: { email: string; displayName?: string };
}) {
  const isSignup = props.mode === "signup";
  const hasInvite = Boolean(props.inviteCode);
  const requiresInvite = isSignup && props.isPrivateBeta && !hasInvite;

  return (
    <>
      <SiteHeader host={props.host} showSignOut={Boolean(props.loggedInUser)} />
      <main class="sheet">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(59, 130, 246, 0.1); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.8125rem; font-weight: 500; margin-bottom: 1rem;">
            <span>Intelligent Email Control &bull; Private Beta</span>
          </div>
          <h1 style="font-size: 2.25rem; line-height: 1.2; margin-bottom: 0.75rem; font-weight: 700; letter-spacing: -0.025em;">
            Your email, managed through normal conversation.
          </h1>
          <p class="lede" style="max-width: 38rem; margin: 0 auto; color: #94a3b8; font-size: 1.0625rem;">
            Connect Gmail, Outlook, or Proton. Receive daily executive briefings, filter noise automatically, and control everything via ChatGPT or Claude with 100% human approval.
          </p>
        </div>

        {props.error && <Alert tone="no" title={props.error} />}
        {props.success && <Alert tone="yes" title={props.success} />}

        {props.loggedInUser ? (
          <section class="card" style="max-width: 28rem; margin: 0 auto 2.5rem auto;">
            <div class="card-header">
              <h2 class="card-title">Welcome back, {props.loggedInUser.displayName || props.loggedInUser.email.split("@")[0]}</h2>
              <p class="card-desc">You are already signed in to your personal Mailwarden vault.</p>
            </div>
            <div class="card-content">
              <div style="display: flex; align-items: center; justify-content: space-between; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.875rem 1rem; margin-bottom: 1.25rem;">
                <div>
                  <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600;">Active Vault:</div>
                  <div style="font-size: 0.9375rem; font-weight: 600; color: var(--foreground);">{props.loggedInUser.email}</div>
                </div>
                <span style="font-size: 0.75rem; background: rgba(74, 222, 128, 0.15); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600;">Signed In</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                <a
                  href="/portal"
                  style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: var(--primary); color: var(--primary-foreground); text-decoration: none; padding: 0.65rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.875rem;"
                >
                  <span>Go to Vault Dashboard &rarr;</span>
                </a>
                <a
                  href="/portal/logout"
                  style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: var(--secondary); color: var(--secondary-foreground); border: 1px solid var(--border); text-decoration: none; padding: 0.55rem 1rem; border-radius: var(--radius-md); font-weight: 500; font-size: 0.8125rem;"
                >
                  <span>Sign Out</span>
                </a>
              </div>
            </div>
          </section>
        ) : (
          <section class="card" style="max-width: 26rem; margin: 0 auto 2.5rem auto;">
            <div class="card-header">
              <h2 class="card-title">{isSignup ? "Create Your Vault" : "Sign in to Mailwarden"}</h2>
              <p class="card-desc">
                {isSignup
                  ? "Initialize your secure, encrypted personal mailbox vault."
                  : "Enter your vault credentials to access your connected mailboxes."}
              </p>
            </div>
            <div class="card-content">
              <form method="post" action={isSignup ? "/portal/auth/signup" : "/portal/auth/login"}>
                {props.inviteCode && (
                  <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 0.75rem; border-radius: 6px; font-size: 0.8125rem; margin-bottom: 1rem;">
                    <strong>Private Beta Invite Code Applied:</strong> <code style="font-family: monospace;">{props.inviteCode}</code>
                  </div>
                )}
                {requiresInvite && !props.inviteCode && (
                  <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); color: #fef08a; padding: 0.75rem; border-radius: 6px; font-size: 0.8125rem; margin-bottom: 1rem;">
                    <strong>Private Beta Notice:</strong> Mailwarden is currently invite-only. Please provide an invite code or use an invite link to create a new vault.
                  </div>
                )}

                <div style="margin-bottom: 1rem;">
                  <label for="email" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="you@domain.com"
                    required
                    autocomplete="username"
                    autofocus
                    style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                  />
                </div>

                {isSignup && (
                  <div style="margin-bottom: 1rem;">
                    <label for="displayName" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                      Display Name <span style="font-weight: 400; color: var(--muted-foreground);">(optional)</span>
                    </label>
                    <input
                      type="text"
                      id="displayName"
                      name="displayName"
                      placeholder="e.g. Thiago"
                      autocomplete="name"
                      style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                    />
                  </div>
                )}

                <div style="margin-bottom: 1rem;">
                  <label for="password" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                    Master Password
                  </label>
                  <div style="position: relative;">
                    <input
                      type="password"
                      id="password"
                      name="password"
                      placeholder={isSignup ? "Create a strong master password" : "Enter your master password"}
                      required
                      autocomplete={isSignup ? "new-password" : "current-password"}
                      style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                    />
                  </div>
                </div>

                {isSignup && (
                  <div style="margin-bottom: 1rem;">
                    <label for="invite" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                      Invite Code
                    </label>
                    <input
                      type="text"
                      id="invite"
                      name="invite"
                      value={props.inviteCode || ""}
                      placeholder="e.g. mw_inv_..."
                      required={Boolean(props.isPrivateBeta)}
                      style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem; font-family: monospace;"
                    />
                  </div>
                )}

                <div style="margin-top: 1.25rem;">
                  <button
                    type="submit"
                    style="width: 100%; background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.65rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.875rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;"
                  >
                    <span>{isSignup ? "Create Vault \u2192" : "Sign in \u2192"}</span>
                  </button>
                </div>
              </form>

              <div style="margin-top: 1rem; text-align: center; font-size: 0.8125rem; color: #94a3b8;">
                {isSignup ? (
                  <span>
                    Already have a vault? <a href="/portal/login" style="color: #60a5fa; text-decoration: none; font-weight: 500;">Sign in</a>
                  </span>
                ) : (
                  <span>
                    Need to create a vault? <a href="/portal/signup" style="color: #60a5fa; text-decoration: none; font-weight: 500;">Create Vault</a>
                  </span>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

export function PortalDashboardPage(props: PortalDashboardPageProps) {
  const isOrg = props.activeWorkspace.kind === "team";
  const activeTab = props.currentTab || "overview";
  // No relay data means no relay: never invent a healthy one.
  const relay = props.relayStatus || {
    status: "offline" as const,
    connectedAccountsCount: 0,
    activeDevicesCount: 0,
    lastSeenAt: undefined,
  };
  const devices = props.relayDevices || [];
  const activeDevices = devices.filter((device) => !device.revokedAt);
  /** The endpoint a registered device reported, or nothing. Never a placeholder. */
  const relayEndpoint = activeDevices.map((device) => device.health?.endpoint).find(Boolean);
  const relayBadge = formatRelayStatusBadge(relay.status);

  return (
    <>
      <SiteHeader host={props.host} showSignOut={true} />

      <main class="sheet" style="max-width: 68rem; margin: 0 auto; padding: 1.5rem 1rem 4rem 1rem;">
        {/* TOP BAR: WORKSPACE SWITCHER & USER BADGE */}
        <div
          style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);"
        >
          {/* Workspace Switcher */}
          <div style="position: relative; display: flex; align-items: center; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.8125rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em;">
                Workspace:
              </span>
              <div class="workspace-switcher-dropdown" style="position: relative;">
                <button
                  type="button"
                  id="workspaceSwitcherBtn"
                  data-action="toggle-ws-menu"
                  style="display: inline-flex; align-items: center; gap: 0.6rem; background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.4rem 0.85rem; border-radius: var(--radius-md); font-size: 0.875rem; font-weight: 600; cursor: pointer;"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  <span style="font-size: 1rem;">{isOrg ? "\uD83C\uDFE2" : "\uD83D\uDC64"}</span>
                  <span>{props.activeWorkspace.name}</span>
                  <span style="font-size: 0.7rem; color: var(--muted-foreground); background: rgba(255,255,255,0.06); padding: 0.1rem 0.4rem; border-radius: 4px; text-transform: uppercase;">
                    {props.activeWorkspace.kind}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                <div
                  id="workspaceDropdownMenu"
                  style="display: none; position: absolute; top: calc(100% + 6px); left: 0; min-width: 16rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); z-index: 50; padding: 0.5rem 0;"
                >
                  <div style="padding: 0.35rem 0.85rem; font-size: 0.7rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em;">
                    Personal Workspaces
                  </div>
                  {props.workspaces
                    .filter((w) => w.kind === "personal")
                    .map((w) => (
                      <a
                        href={`/portal?ws=${w.id}`}
                        style={`display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.85rem; color: var(--foreground); text-decoration: none; font-size: 0.875rem; ${w.id === props.activeWorkspace.id ? "background: rgba(255,255,255,0.06); font-weight: 600;" : ""}`}
                      >
                        <span style="display: flex; align-items: center; gap: 0.5rem;">
                          <span>\uD83D\uDC64</span>
                          <span>{w.name}</span>
                        </span>
                        {w.id === props.activeWorkspace.id && <span style="color: #34d399;">✓</span>}
                      </a>
                    ))}

                  <div style="height: 1px; background: var(--border); margin: 0.4rem 0;"></div>

                  <div style="padding: 0.35rem 0.85rem; font-size: 0.7rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em;">
                    Team Organizations
                  </div>
                  {props.workspaces
                    .filter((w) => w.kind === "team")
                    .map((w) => (
                      <a
                        href={`/portal?ws=${w.id}`}
                        style={`display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.85rem; color: var(--foreground); text-decoration: none; font-size: 0.875rem; ${w.id === props.activeWorkspace.id ? "background: rgba(255,255,255,0.06); font-weight: 600;" : ""}`}
                      >
                        <span style="display: flex; align-items: center; gap: 0.5rem;">
                          <span>\uD83C\uDFE2</span>
                          <span>{w.name}</span>
                        </span>
                        {w.id === props.activeWorkspace.id && <span style="color: #34d399;">✓</span>}
                      </a>
                    ))}

                  <div style="height: 1px; background: var(--border); margin: 0.4rem 0;"></div>

                  <button
                    type="button"
                    data-action="open-create-org"
                    style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.85rem; background: none; border: none; color: #60a5fa; font-size: 0.8125rem; font-weight: 600; cursor: pointer; text-align: left;"
                  >
                    <span>+</span>
                    <span>Create Organization</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* User badge and actions */}
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="text-align: right;">
              <div style="font-size: 0.875rem; font-weight: 600; color: var(--foreground);">{props.user.displayName}</div>
              <div style="font-size: 0.75rem; color: var(--muted-foreground);">{props.user.email}</div>
            </div>
            <button
              type="button"
              data-action="open-chatgpt-modal"
              style="display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
            >
              <span>\uD83E\uDD16 Connect ChatGPT</span>
            </button>
          </div>
        </div>

        {/* FEEDBACK ALERTS */}
        {props.connectedMessage && <Alert tone="yes" title={props.connectedMessage} />}
        {props.disconnectedMessage && <Alert tone="info" title={props.disconnectedMessage} />}

        {/* ORGANIZATION NAVIGATION TABS (Only visible when inside an organization) */}
        {isOrg && (
          <div
            role="tablist"
            style="display: flex; gap: 0.4rem; margin-bottom: 1.5rem; overflow-x: auto; padding-bottom: 0.25rem; border-bottom: 1px solid var(--border);"
          >
            {[
              { id: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
              { id: "members", label: `Members (${props.members?.length || 1})`, icon: "\uD83D\uDC65" },
              { id: "mailboxes", label: `Mailboxes (${props.accounts.length})`, icon: "\uD83D\uDCEC" },
              { id: "relay", label: "Proton Relay", icon: "\u26A1" },
              { id: "devices", label: `Bridge Devices (${devices.length})`, icon: "\uD83D\uDCBB" },
              { id: "plan", label: "Plan & Security", icon: "\uD83D\uDEE1\uFE0F" },
            ].map((tab) => (
              <a
                href={`/portal?ws=${props.activeWorkspace.id}&tab=${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id ? "true" : "false"}
                style={`display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.5rem 0.9rem; border-radius: var(--radius-md) var(--radius-md) 0 0; text-decoration: none; font-size: 0.875rem; font-weight: 600; white-space: nowrap; ${
                  activeTab === tab.id
                    ? "background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-bottom-color: var(--card);"
                    : "color: var(--muted-foreground);"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </a>
            ))}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* PERSONAL WORKSPACE VIEW                              */}
        {/* ---------------------------------------------------- */}
        {!isOrg && (
          <>
            {/* Quick Summary Card */}
            <div
              style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;"
            >
              <div>
                <h2 style="font-size: 1.125rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--foreground);">
                  Personal Mail Vault
                </h2>
                <p style="margin: 0; font-size: 0.875rem; color: var(--muted-foreground);">
                  Connected accounts are synchronized directly to your personal vault with 100% human-approved outbound protection.
                </p>
              </div>
              <div style="display: flex; gap: 0.75rem; align-items: center;">
                <button
                  type="button"
                  data-action="open-create-org"
                  style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  <span>\uD83C\uDFE2 Create Organization &rarr;</span>
                </button>
              </div>
            </div>

            {/* SECTION 1: Connected Mailboxes */}
            <section class="card" style="margin-bottom: 1.5rem;">
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h2 class="card-title">1. Connected Mailboxes ({props.accounts.length})</h2>
                  <p class="card-desc">Link your personal Gmail, Microsoft 365, or Proton accounts.</p>
                </div>
              </div>
              <div class="card-content">
                {props.accounts.length === 0 ? (
                  <div style="padding: 2rem 1rem; background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border); border-radius: var(--radius-md); text-align: center; margin-bottom: 1rem;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">\uD83D\uDCEC</div>
                    <p style="margin: 0 0 0.5rem 0; font-size: 0.9375rem; font-weight: 600; color: var(--foreground);">
                      No mailboxes connected yet
                    </p>
                    <p style="margin: 0; font-size: 0.8125rem; color: var(--muted-foreground);">
                      Connect your first email account below to start receiving conversational briefings.
                    </p>
                  </div>
                ) : (
                  <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.25rem;">
                    {props.accounts.map((acc) => {
                      const statusBadge = formatMailboxStatusBadge(acc.status as any);
                      return (
                        <div
                          style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: var(--radius-md);"
                        >
                          <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span
                              style={`background: ${
                                acc.provider === "gmail" ? "#ea4335" : acc.provider === "proton" ? "#6d4aff" : "#00a4ef"
                              }; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase;`}
                            >
                              {acc.provider}
                            </span>
                            <div>
                              <div style="font-weight: 600; font-size: 0.875rem; color: var(--foreground);">
                                {acc.emailAddress}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.4rem;">
                                <span style={`display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusBadge.dotColor};`}></span>
                                <span>{statusBadge.label}</span>
                              </div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <form method="post" action="/portal/accounts/sync" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                              >
                                Sync Now
                              </button>
                            </form>

                            <form method="post" action="/portal/accounts/disconnect" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn-confirm-delete"
                                style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                              >
                                Disconnect
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Connect Provider Buttons */}
                <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border);">
                  {props.googleAuthUrl ? (
                    <a
                      href={props.googleAuthUrl}
                      style="display: inline-flex; align-items: center; gap: 0.5rem; background: #ea4335; color: #fff; text-decoration: none; padding: 0.55rem 0.95rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.8125rem;"
                    >
                      <span>Connect Google / Gmail</span>
                    </a>
                  ) : (
                    <button
                      disabled
                      style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid var(--border); padding: 0.55rem 0.95rem; border-radius: var(--radius-md); font-size: 0.8125rem;"
                    >
                      Google (Configuring...)
                    </button>
                  )}

                  {props.microsoftAuthUrl ? (
                    <a
                      href={props.microsoftAuthUrl}
                      style="display: inline-flex; align-items: center; gap: 0.5rem; background: #00a4ef; color: #fff; text-decoration: none; padding: 0.55rem 0.95rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.8125rem;"
                    >
                      <span>Connect Microsoft 365</span>
                    </a>
                  ) : (
                    <button
                      disabled
                      style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid var(--border); padding: 0.55rem 0.95rem; border-radius: var(--radius-md); font-size: 0.8125rem;"
                    >
                      Microsoft (Configuring...)
                    </button>
                  )}

                  <button
                    type="button"
                    data-action="open-proton-modal"
                    style="display: inline-flex; align-items: center; gap: 0.5rem; background: #6d4aff; color: #fff; border: none; padding: 0.55rem 0.95rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.8125rem; cursor: pointer;"
                  >
                    <span>Connect Proton Mail</span>
                  </button>
                </div>
              </div>
            </section>

            {/* SECTION 2: AI & MCP Access Tokens */}
            <section class="card" style="margin-bottom: 1.5rem;">
              <div class="card-header">
                <h2 class="card-title">2. Connect Mailwarden to ChatGPT &amp; Claude</h2>
                <p class="card-desc">Use the credentials below to add Mailwarden as a Custom MCP Tool in ChatGPT or Claude Desktop.</p>
              </div>
              <div class="card-content">
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                  <div>
                    <label for="mcpSseUrlInput" style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase;">
                      MCP Server URL (SSE)
                    </label>
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
                      <input
                        id="mcpSseUrlInput"
                        type="text"
                        readonly
                        value={`https://${props.host}/mcp/sse`}
                        style="width: 100%; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-family: monospace; font-size: 0.8125rem;"
                      />
                      <button
                        type="button"
                        class="btn-copy"
                        data-target="mcpSseUrlInput"
                        style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label for="vaultTokenInput" style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase;">
                      Vault Access Token (Bearer)
                    </label>
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
                      <input
                        id="vaultTokenInput"
                        type="password"
                        readonly
                        value={props.token}
                        style="width: 100%; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-family: monospace; font-size: 0.8125rem;"
                      />
                      <button
                        type="button"
                        class="btn-copy"
                        data-target="vaultTokenInput"
                        style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ---------------------------------------------------- */}
        {/* ORGANIZATION WORKSPACE VIEW                          */}
        {/* ---------------------------------------------------- */}
        {isOrg && (
          <>
            {/* TAB 1: OVERVIEW */}
            {activeTab === "overview" && (
              <div>
                {/* Org Metric Cards Grid */}
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                  {/* Members Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.25rem;">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                      Team Members
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {props.members?.length || 1}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=members`}
                      style="font-size: 0.75rem; color: #60a5fa; text-decoration: none; font-weight: 600;"
                    >
                      Manage Teammates &rarr;
                    </a>
                  </div>

                  {/* Mailboxes Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.25rem;">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                      Organization Mailboxes
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {props.accounts.length}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=mailboxes`}
                      style="font-size: 0.75rem; color: #60a5fa; text-decoration: none; font-weight: 600;"
                    >
                      View Mailboxes &rarr;
                    </a>
                  </div>

                  {/* Proton Relay Status Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.25rem;">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                      Proton Relay
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0;">
                      <span style={`display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${relayBadge.dotColor};`}></span>
                      <span style="font-size: 1.25rem; font-weight: 700; color: var(--foreground);">
                        {relayBadge.label}
                      </span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--muted-foreground);">
                      {relay.activeDevicesCount} server device active
                    </div>
                  </div>

                  {/* Bridge Device Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.25rem;">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                      Bridge Devices
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {devices.length}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=devices`}
                      style="font-size: 0.75rem; color: #60a5fa; text-decoration: none; font-weight: 600;"
                    >
                      View Devices &rarr;
                    </a>
                  </div>
                </div>

                {/* Relay Highlight Banner */}
                <div
                  style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; margin-bottom: 1.5rem;"
                >
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
                    <div>
                      <div style="display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(109, 74, 255, 0.15); color: #a78bfa; border: 1px solid rgba(109, 74, 255, 0.3); padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 0.5rem;">
                        <span>\u26A1 Shared Organization Relay</span>
                      </div>
                      <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0 0 0.35rem 0; color: var(--foreground);">
                        {props.activeWorkspace.name} is ready for Proton Mail
                      </h3>
                      <p style="margin: 0; font-size: 0.875rem; color: var(--muted-foreground); max-width: 36rem;">
                        All organization members can connect their individual Proton accounts with zero local bridge installation. Synchronization is managed automatically by your team relay.
                      </p>
                    </div>

                    <div style="display: flex; gap: 0.5rem;">
                      <button
                        type="button"
                        data-action="open-proton-modal"
                        style="background: #6d4aff; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.8125rem; cursor: pointer;"
                      >
                        + Connect Proton Account
                      </button>
                      <button
                        type="button"
                        data-action="open-bridge-wizard"
                        style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-weight: 600; font-size: 0.8125rem; cursor: pointer;"
                      >
                        Relay Settings
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MEMBERS */}
            {activeTab === "members" && (
              <section class="card">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <h2 class="card-title">Team Members</h2>
                    <p class="card-desc">Manage who has access to {props.activeWorkspace.name} and assign workspace roles.</p>
                  </div>
                  <button
                    type="button"
                    data-action="open-invite-member"
                    style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    + Invite Teammate
                  </button>
                </div>
                <div class="card-content">
                  {props.createdOrgInviteUrl && (
                    <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-md); padding: 0.875rem 1rem; margin-bottom: 1.25rem;">
                      <div style="font-weight: 600; font-size: 0.875rem; color: #60a5fa; margin-bottom: 0.25rem;">
                        Teammate Invitation Created
                      </div>
                      <div style="display: flex; gap: 0.5rem;">
                        <input
                          id="orgInviteInput"
                          type="text"
                          readonly
                          value={props.createdOrgInviteUrl}
                          style="width: 100%; background: var(--input); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-family: monospace; font-size: 0.8125rem;"
                        />
                        <button
                          type="button"
                          class="btn-copy"
                          data-target="orgInviteInput"
                          style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Members Table */}
                  <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
                      <thead>
                        <tr style="border-bottom: 1px solid var(--border); color: var(--muted-foreground); font-size: 0.75rem; text-transform: uppercase;">
                          <th style="padding: 0.75rem 0.5rem;">Member</th>
                          <th style="padding: 0.75rem 0.5rem;">Role</th>
                          <th style="padding: 0.75rem 0.5rem;">Status</th>
                          <th style="padding: 0.75rem 0.5rem; text-align: right;">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(props.members || [
                          {
                            id: "mem_self",
                            userId: props.user.tenantId,
                            displayName: props.user.displayName,
                            email: props.user.email,
                            role: props.activeWorkspace.role,
                            joinedAt: new Date(),
                            isSelf: true,
                          },
                        ]).map((m) => {
                          const roleInfo = formatMembershipRole(m.role);
                          return (
                            <tr style="border-bottom: 1px solid var(--border);">
                              <td style="padding: 0.875rem 0.5rem;">
                                <div style="font-weight: 600; color: var(--foreground);">{m.displayName}</div>
                                <div style="font-size: 0.75rem; color: var(--muted-foreground);">{m.email}</div>
                              </td>
                              <td style="padding: 0.875rem 0.5rem;">
                                <span
                                  style={`background: ${roleInfo.badgeBg}; color: ${roleInfo.badgeColor}; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;`}
                                >
                                  {roleInfo.label}
                                </span>
                              </td>
                              <td style="padding: 0.875rem 0.5rem;">
                                <span style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: #34d399;">
                                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #34d399;"></span>
                                  <span>Active</span>
                                </span>
                              </td>
                              <td style="padding: 0.875rem 0.5rem; text-align: right;">
                                {m.isSelf ? (
                                  <span style="font-size: 0.75rem; color: var(--muted-foreground);">You</span>
                                ) : (
                                  <form method="post" action="/portal/organizations/members/remove" style="display: inline;">
                                    <input type="hidden" name="orgId" value={props.activeWorkspace.id} />
                                    <input type="hidden" name="memberUserId" value={m.userId} />
                                    <button
                                      type="submit"
                                      class="btn-confirm-delete"
                                      style="background: none; border: none; color: #f87171; font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                                    >
                                      Remove
                                    </button>
                                  </form>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 3: MAILBOXES */}
            {activeTab === "mailboxes" && (
              <section class="card">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <h2 class="card-title">Organization Mailboxes ({props.accounts.length})</h2>
                    <p class="card-desc">Mailboxes connected under {props.activeWorkspace.name}.</p>
                  </div>
                  <button
                    type="button"
                    data-action="open-proton-modal"
                    style="background: #6d4aff; color: #fff; border: none; padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    + Connect Proton Mailbox
                  </button>
                </div>
                <div class="card-content">
                  <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                    {props.accounts.map((acc) => {
                      const statusBadge = formatMailboxStatusBadge(acc.status as any);
                      return (
                        <div
                          style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: var(--radius-md);"
                        >
                          <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span
                              style={`background: ${
                                acc.provider === "gmail" ? "#ea4335" : acc.provider === "proton" ? "#6d4aff" : "#00a4ef"
                              }; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase;`}
                            >
                              {acc.provider}
                            </span>
                            <div>
                              <div style="font-weight: 600; font-size: 0.875rem; color: var(--foreground);">
                                {acc.emailAddress}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.4rem;">
                                <span style={`display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusBadge.dotColor};`}></span>
                                <span>{statusBadge.label}</span>
                              </div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <form method="post" action="/portal/accounts/sync" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                              >
                                Sync Now
                              </button>
                            </form>

                            <form method="post" action="/portal/accounts/disconnect" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn-confirm-delete"
                                style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                              >
                                Disconnect
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* TAB 4: PROTON RELAY */}
            {activeTab === "relay" && (
              <section class="card">
                <div class="card-header">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                      <h2 class="card-title">Organization Proton Relay</h2>
                      <p class="card-desc">Centralized synchronization bridge for all team Proton Mail accounts.</p>
                    </div>
                    <span
                      style={`background: ${relayBadge.badgeBg}; color: ${relayBadge.badgeColor}; border: 1px solid ${relayBadge.badgeBorder}; font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.4rem;`}
                    >
                      <span style={`display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${relayBadge.dotColor};`}></span>
                      <span>{relayBadge.label}</span>
                    </span>
                  </div>
                </div>
                <div class="card-content">
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                        Gateway Endpoint
                      </div>
                      <div style="font-family: monospace; font-size: 0.8125rem; color: #38bdf8; margin-top: 0.25rem;">
                        {relayEndpoint || "Not reported yet"}
                      </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                        Accounts Connected
                      </div>
                      <div style="font-size: 1.125rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {relay.connectedAccountsCount} active Proton accounts
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 0.75rem;">
                    <button
                      type="button"
                      data-action="open-diagnostics"
                      style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                    >
                      \uD83D\uDD0D Run Diagnostics
                    </button>
                    <button
                      type="button"
                      data-action="open-bridge-wizard"
                      style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                    >
                      \u2699\uFE0F Setup / Reconfigure Bridge
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 5: BRIDGE DEVICES */}
            {activeTab === "devices" && (
              <section class="card">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <h2 class="card-title">Registered Bridge Devices</h2>
                    <p class="card-desc">Servers and computers running Mailwarden Bridge for this organization.</p>
                  </div>
                  <button
                    type="button"
                    data-action="open-bridge-wizard"
                    style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    + Pair New Device
                  </button>
                </div>
                <div class="card-content">
                  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    {devices.length === 0 && (
                      <div style="padding: 1.25rem; background: rgba(255,255,255,0.02); border: 1px dashed var(--border); border-radius: var(--radius-md); text-align: center;">
                        <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground);">
                          No Bridge devices yet
                        </div>
                        <div style="font-size: 0.8125rem; color: var(--muted-foreground); margin-top: 0.35rem;">
                          Install Mailwarden Bridge on the server that runs Proton Bridge, run
                          <span style="font-family: monospace;"> mailwarden-bridge setup</span>, then approve its code here.
                        </div>
                      </div>
                    )}
                    {devices.map((dev) => {
                      const devBadge = formatRelayStatusBadge(dev.status as any);
                      return (
                        <div
                          style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: var(--radius-md);"
                        >
                          <div style="display: flex; align-items: center; gap: 0.85rem;">
                            <span style="font-size: 1.5rem;">\uD83D\uDDA5\uFE0F</span>
                            <div>
                              <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground);">
                                {dev.name}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.15rem;">
                                <span>{dev.platform}</span> &bull; <span>{dev.version}</span> &bull;{" "}
                                <span>
                                  {dev.revokedAt
                                    ? "Revoked"
                                    : dev.lastSeenAt
                                      ? `Last heartbeat ${new Date(dev.lastSeenAt).toUTCString()}`
                                      : "No heartbeat yet"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <span
                              style={`background: ${devBadge.badgeBg}; color: ${devBadge.badgeColor}; border: 1px solid ${devBadge.badgeBorder}; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px;`}
                            >
                              {devBadge.label}
                            </span>
                            <button
                              type="button"
                              data-action="open-diagnostics"
                              data-device={dev.id}
                              style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                            >
                              Diagnostics
                            </button>
                            <form method="post" action="/portal/organizations/devices/revoke" style="display: inline;">
                              <input type="hidden" name="orgId" value={props.activeWorkspace.id} />
                              <input type="hidden" name="deviceId" value={dev.id} />
                              <button
                                type="submit"
                                class="btn-confirm-delete"
                                style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                              >
                                Revoke
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* TAB 6: PLAN & SECURITY */}
            {activeTab === "plan" && (
              <section class="card">
                <div class="card-header">
                  <h2 class="card-title">Organization Plan &amp; Capabilities</h2>
                  <p class="card-desc">Current workspace quota, seats, and security settings.</p>
                </div>
                <div class="card-content">
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                        Seats
                      </div>
                      <div style="font-size: 1.25rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {props.members?.length || 1} / {props.planCapabilities?.maxOrganizationSeats || 10} seats used
                      </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                        Bridge Devices
                      </div>
                      <div style="font-size: 1.25rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {devices.length} / {props.planCapabilities?.maxRelayDevices || 3} relays active
                      </div>
                    </div>

                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600; text-transform: uppercase;">
                        Shared Proton Relay
                      </div>
                      <div style="font-size: 1.25rem; font-weight: 700; color: #34d399; margin-top: 0.25rem;">
                        Active &bull; Unlimited
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* ---------------------------------------------------- */}
        {/* MODALS                                               */}
        {/* ---------------------------------------------------- */}

        {/* MODAL 1: Create Organization */}
        <div
          id="createOrgModal"
          class="modal-backdrop"
          style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
        >
          <div
            style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 28rem; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);"
          >
            <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0 0 0.5rem 0; color: var(--foreground);">
              Create Organization
            </h3>
            <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              Organizations let you invite teammates, share a centralized Proton Relay, and manage company mailboxes.
            </p>

            <form method="post" action="/portal/organizations/create">
              <div style="margin-bottom: 1rem;">
                <label for="orgNameInput" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  Organization Name
                </label>
                <input
                  type="text"
                  name="name"
                  id="orgNameInput"
                  placeholder="e.g. FoxDevStudio"
                  required
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
                <button
                  type="button"
                  data-action="close-create-org"
                  style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Create &rarr;
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* MODAL 2: Invite Member */}
        <div
          id="inviteMemberModal"
          class="modal-backdrop"
          style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
        >
          <div
            style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 28rem; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);"
          >
            <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0 0 0.5rem 0; color: var(--foreground);">
              Invite Teammate to {props.activeWorkspace.name}
            </h3>
            <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              Send an invitation link to your coworker. They will get access to this organization workspace.
            </p>

            <form method="post" action="/portal/organizations/invites/create">
              <input type="hidden" name="orgId" value={props.activeWorkspace.id} />

              <div style="margin-bottom: 1rem;">
                <label for="inviteEmailInput" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  Coworker Email
                </label>
                <input
                  type="email"
                  id="inviteEmailInput"
                  name="email"
                  placeholder="dan@foxdevstudio.com"
                  required
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                />
              </div>

              <div style="margin-bottom: 1rem;">
                <label for="inviteRoleSelect" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  Role in Organization
                </label>
                <select
                  id="inviteRoleSelect"
                  name="role"
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                >
                  <option value="member">Member (can connect mailboxes &amp; view team status)</option>
                  <option value="admin">Admin (can invite members &amp; manage relays)</option>
                </select>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
                <button
                  type="button"
                  data-action="close-invite-member"
                  style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Create Invitation Link
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* MODAL 3: Bridge Setup & Onboarding Wizard */}
        <div
          id="bridgeWizardModal"
          class="modal-backdrop"
          style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
        >
          <div
            style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 34rem; padding: 1.75rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); max-height: 90vh; overflow-y: auto;"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--foreground);">
                Set Up Mailwarden Bridge
              </h3>
              <button
                type="button"
                data-action="close-bridge-wizard"
                style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer;"
              >
                &times;
              </button>
            </div>

            <p style="font-size: 0.875rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              Where should Mailwarden Bridge run for your team?
            </p>

            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
              {/* Option A: Server */}
              <div
                style="border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.05); border-radius: var(--radius-md); padding: 1rem;"
              >
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                  <div style="font-weight: 700; font-size: 0.9375rem; color: #60a5fa;">
                    \uD83C\uDFE2 Company Server (Recommended for Teams)
                  </div>
                  <span style="font-size: 0.7rem; background: #2563eb; color: #fff; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700;">
                    24/7 SYNC
                  </span>
                </div>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 0.75rem 0;">
                  A central Linux server (AlmaLinux, Debian, Ubuntu) keeps Proton accounts syncing continuously even when employee laptops are turned off.
                </p>
                <div style="font-family: monospace; font-size: 0.75rem; background: #090d16; padding: 0.6rem; border-radius: 4px; color: #38bdf8; border: 1px solid var(--border);">
                  curl -fsSL https://mailwarden.dev/install-bridge.sh | bash
                </div>
              </div>

              {/* Option B: Desktop */}
              <div
                style="border: 1px solid var(--border); background: rgba(255, 255, 255, 0.02); border-radius: var(--radius-md); padding: 1rem;"
              >
                <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground); margin-bottom: 0.35rem;">
                  \uD83D\uDCBB This Computer (Desktop App)
                </div>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 0.75rem 0;">
                  Mailwarden Bridge runs in the background on this computer. Synchronization is active whenever this computer is online.
                </p>
                <button
                  type="button"
                  data-action="download-desktop"
                  style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.4rem 0.75rem; border-radius: var(--radius-md); font-size: 0.75rem; font-weight: 600; cursor: pointer;"
                >
                  Download Mailwarden Desktop Companion &rarr;
                </button>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button
                type="button"
                data-action="close-bridge-wizard"
                style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
              >
                Done
              </button>
            </div>
          </div>
        </div>

        {/* MODAL 4: Diagnostics & Safe Repair — one per registered device, from real heartbeat health */}
        {devices.map((dev) => {
          const health = dev.health;
          const controllable = Boolean(health?.endpoint) && !dev.revokedAt;
          return (
            <div
              id={`diagnosticsModal_${dev.id}`}
              class="modal-backdrop"
              style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
            >
              <div
                style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 32rem; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);"
              >
                <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0 0 0.5rem 0; color: var(--foreground);">
                  \uD83D\uDD0D {dev.name}
                </h3>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
                  {health
                    ? `Reported by the device at ${new Date(health.observedAt).toUTCString()}.`
                    : "This device has not reported health yet. It reports on its first heartbeat."}
                </p>

                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
                  {(health?.components || []).map((component) => (
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.65rem 0.85rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius-md);">
                      <span style="font-size: 0.8125rem; font-weight: 600; text-transform: capitalize;">
                        {component.component}
                      </span>
                      <span
                        style={`font-size: 0.75rem; font-weight: 600; text-align: right; color: ${
                          component.status === "ok"
                            ? "#34d399"
                            : component.status === "degraded" || component.status === "needs_attention"
                              ? "#fbbf24"
                              : component.status === "down"
                                ? "#f87171"
                                : "#9ca3af"
                        };`}
                      >
                        {component.detail}
                      </span>
                    </div>
                  ))}
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                  {controllable ? (
                    <form method="post" action="/portal/organizations/relay/repair" style="display: flex; gap: 0.5rem; align-items: center;">
                      <input type="hidden" name="orgId" value={props.activeWorkspace.id} />
                      <input type="hidden" name="deviceId" value={dev.id} />
                      <select
                        name="actionId"
                        style="background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.4rem 0.5rem; border-radius: var(--radius-md); font-size: 0.8125rem;"
                      >
                        <option value="recheck_proton">Check Proton Bridge again</option>
                        <option value="restart_gateway">Restart the Mailwarden gateway</option>
                        <option value="restart_tunnel">Reconnect the secure tunnel</option>
                        <option value="refresh_registration">Refresh this device's registration</option>
                        <option value="fix_permissions">Repair credential file permissions</option>
                      </select>
                      <button
                        type="submit"
                        style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                      >
                        \u26A1 Run repair
                      </button>
                    </form>
                  ) : (
                    <span style="font-size: 0.75rem; color: var(--muted-foreground); max-width: 22rem;">
                      Remote repair needs a reachable relay endpoint. Run{" "}
                      <span style="font-family: monospace;">mailwarden-bridge doctor</span> on the device itself.
                    </span>
                  )}

                  <button
                    type="button"
                    data-action="close-diagnostics"
                    data-device={dev.id}
                    style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* MODAL 5: Proton Mail Connection Modal */}
        <div
          id="protonModal"
          class="modal-backdrop"
          style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
        >
          <div
            style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 30rem; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground);">
                Connect Proton Mailbox
              </h3>
              <button
                type="button"
                data-action="close-proton-modal"
                style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer;"
              >
                &times;
              </button>
            </div>

            <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              {isOrg
                ? `This account will connect through the ${props.activeWorkspace.name} Proton Relay.`
                : "Connect your Proton account via your Mailwarden Bridge connection."}
            </p>

            <form method="post" action="/portal/accounts/connect-proton">
              <input type="hidden" name="workspaceId" value={props.activeWorkspace.id} />
              <input type="hidden" name="mode" value="gateway" />
              <input type="hidden" name="gatewayUrl" value={relayEndpoint ? `${relayEndpoint}/v1` : ""} />
              {!relayEndpoint && (
                <p style="font-size: 0.8125rem; color: #fbbf24; margin: 0 0 1rem 0;">
                  No Mailwarden Bridge has reported a reachable relay endpoint yet. Pair a Bridge device first;
                  Proton accounts connect through it.
                </p>
              )}

              <div style="margin-bottom: 1rem;">
                <label for="protonEmailInput" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  Proton Email Address
                </label>
                <input
                  type="email"
                  name="emailAddress"
                  id="protonEmailInput"
                  placeholder="thiago@foxdevstudio.com"
                  required
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem;"
                />
              </div>

              <div style="margin-bottom: 1rem;">
                <label for="bridgePasswordInput" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  16-Character Bridge Password
                </label>
                <input
                  type="password"
                  id="bridgePasswordInput"
                  name="bridgePassword"
                  placeholder="e.g. abcd-efgh-ijkl-mnop"
                  required
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem; font-family: monospace;"
                />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
                <button
                  type="button"
                  data-action="close-proton-modal"
                  style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.5rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style="background: #6d4aff; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                >
                  Connect Proton &rarr;
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* MODAL 6: Connect ChatGPT Modal */}
        <div
          id="chatGptModal"
          class="modal-backdrop"
          style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 100; align-items: center; justify-content: center; padding: 1rem;"
        >
          <div
            style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); width: 100%; max-width: 32rem; padding: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground);">
                \uD83E\uDD16 Connect Mailwarden to ChatGPT
              </h3>
              <button
                type="button"
                data-action="close-chatgpt-modal"
                style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer;"
              >
                &times;
              </button>
            </div>

            <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              In ChatGPT, go to <strong>Settings &rarr; Connected Apps &rarr; Add Custom MCP Tool</strong>, then paste the details below:
            </p>

            <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.25rem;">
              <div>
                <label for="chatGptSseUrl" style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase;">
                  Server URL (SSE)
                </label>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
                  <input
                    id="chatGptSseUrl"
                    type="text"
                    readonly
                    value={`https://${props.host}/mcp/sse`}
                    style="width: 100%; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-family: monospace; font-size: 0.8125rem;"
                  />
                  <button
                    type="button"
                    class="btn-copy"
                    data-target="chatGptSseUrl"
                    style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label for="chatGptToken" style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase;">
                  Bearer Token
                </label>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
                  <input
                    id="chatGptToken"
                    type="password"
                    readonly
                    value={props.token}
                    style="width: 100%; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-family: monospace; font-size: 0.8125rem;"
                  />
                  <button
                    type="button"
                    class="btn-copy"
                    data-target="chatGptToken"
                    style="background: var(--secondary); border: 1px solid var(--border); color: var(--foreground); padding: 0.45rem 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button
                type="button"
                data-action="close-chatgpt-modal"
                style="background: var(--primary); color: var(--primary-foreground); border: none; padding: 0.45rem 0.85rem; border-radius: var(--radius-md); font-size: 0.8125rem; font-weight: 600; cursor: pointer;"
              >
                Done
              </button>
            </div>
          </div>
        </div>

        {/* JAVASCRIPT LOGIC VIA EVENT DELEGATION (0 JSX TYPE ERRORS) */}
        <script
          innerHTML={`
          function setModal(id, show) {
            var m = document.getElementById(id);
            if (m) m.style.display = show ? 'flex' : 'none';
          }

          document.addEventListener('click', function(e) {
            var target = e.target.closest('[data-action]') || e.target;
            var action = target.getAttribute ? target.getAttribute('data-action') : null;

            if (action === 'toggle-ws-menu') {
              var menu = document.getElementById('workspaceDropdownMenu');
              if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            } else if (action === 'open-create-org') {
              setModal('createOrgModal', true);
              var menu = document.getElementById('workspaceDropdownMenu');
              if (menu) menu.style.display = 'none';
            } else if (action === 'close-create-org') {
              setModal('createOrgModal', false);
            } else if (action === 'open-invite-member') {
              setModal('inviteMemberModal', true);
            } else if (action === 'close-invite-member') {
              setModal('inviteMemberModal', false);
            } else if (action === 'open-bridge-wizard') {
              setModal('bridgeWizardModal', true);
            } else if (action === 'close-bridge-wizard') {
              setModal('bridgeWizardModal', false);
            } else if (action === 'open-diagnostics') {
              setModal('diagnosticsModal_' + target.getAttribute('data-device'), true);
            } else if (action === 'close-diagnostics') {
              setModal('diagnosticsModal_' + target.getAttribute('data-device'), false);
            } else if (action === 'open-proton-modal') {
              setModal('protonModal', true);
            } else if (action === 'close-proton-modal') {
              setModal('protonModal', false);
            } else if (action === 'open-chatgpt-modal') {
              setModal('chatGptModal', true);
            } else if (action === 'close-chatgpt-modal') {
              setModal('chatGptModal', false);
            } else if (action === 'download-desktop') {
              alert('Mailwarden Desktop Companion pairing initiated.');
            }

            // Copy handler
            var copyBtn = e.target.closest('.btn-copy');
            if (copyBtn) {
              var targetId = copyBtn.getAttribute('data-target');
              var input = document.getElementById(targetId);
              if (input) {
                navigator.clipboard.writeText(input.value);
                var oldText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                copyBtn.style.color = '#34d399';
                setTimeout(function() {
                  copyBtn.textContent = oldText;
                  copyBtn.style.color = '';
                }, 2000);
              }
            }

            // Close modal on backdrop click
            if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
              e.target.style.display = 'none';
            }

            // Close workspace dropdown when clicking outside
            var btn = document.getElementById('workspaceSwitcherBtn');
            var wsMenu = document.getElementById('workspaceDropdownMenu');
            if (btn && wsMenu && !btn.contains(e.target) && !wsMenu.contains(e.target)) {
              wsMenu.style.display = 'none';
            }
          });

          // Confirm delete listeners
          document.addEventListener('submit', function(e) {
            var btn = e.submitter;
            if (btn && btn.classList && btn.classList.contains('btn-confirm-delete')) {
              if (!confirm('Are you sure you want to remove this item?')) {
                e.preventDefault();
              }
            }
          });
        `}
        />
      </main>
    </>
  );
}
