import {
  Alert,
  Record,
  SiteHeader,
  Check,
  X,
  Seal,
  CircleCheck,
  CircleAlert,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  UserIcon,
  BuildingIcon,
  BotIcon,
  CopyIcon,
  SyncIcon,
  LogOutIcon,
  PlusIcon,
  TrashIcon,
  ShieldCheckIcon,
  MailIcon,
  UsersIcon,
  ZapIcon,
  LaptopIcon,
  KeyIcon,
  TerminalIcon,
  ServerIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  GoogleBrandIcon,
  MicrosoftBrandIcon,
  ProtonBrandIcon,
} from "./parts";
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
          <div class="badge-pill" style="margin-bottom: 1rem; border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.08); color: var(--primary);">
            <SparklesIcon size={13} />
            <span>Private Beta &bull; Conversational Email Layer</span>
          </div>
          <h1 style="font-size: 2.25rem; line-height: 1.2; margin-bottom: 0.75rem; font-weight: 700; letter-spacing: -0.03em;">
            Your email, managed through normal conversation.
          </h1>
          <p class="lede" style="max-width: 38rem; margin: 0 auto; color: var(--muted-foreground); font-size: 1.0625rem;">
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
                <span class="badge-pill" style="background: rgba(16, 185, 129, 0.12); color: #10b981; border-color: rgba(16, 185, 129, 0.25);">
                  <span class="status-dot is-live" style="background: #10b981;"></span>
                  Signed In
                </span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                <a
                  href="/portal"
                  class="btn btn-primary"
                  style="text-decoration: none; height: 2.4rem;"
                >
                  <span>Go to Vault Dashboard &rarr;</span>
                </a>
                <a
                  href="/portal/logout"
                  class="btn btn-secondary btn-sm"
                  style="text-decoration: none;"
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
                  <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                    <Check size={14} />
                    <div><strong>Private Beta Invite Code Applied:</strong> <code style="font-family: var(--font-mono);">{props.inviteCode}</code></div>
                  </div>
                )}
                {requiresInvite && !props.inviteCode && (
                  <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); color: #eab308; padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.8125rem; margin-bottom: 1rem;">
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
                      style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem; font-family: var(--font-mono);"
                    />
                  </div>
                )}

                <div style="margin-top: 1.25rem;">
                  <button
                    type="submit"
                    class="btn btn-primary"
                    style="width: 100%; height: 2.5rem; font-size: 0.875rem;"
                  >
                    <span>{isSignup ? "Create Vault \u2192" : "Sign in \u2192"}</span>
                  </button>
                </div>
              </form>

              <div style="margin-top: 1.25rem; text-align: center; font-size: 0.8125rem; color: var(--muted-foreground);">
                {isSignup ? (
                  <span>
                    Already have a vault? <a href="/portal/login" style="font-weight: 600;">Sign in</a>
                  </span>
                ) : (
                  <span>
                    Need to create a vault? <a href="/portal/signup" style="font-weight: 600;">Create Vault</a>
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
      <SiteHeader host={props.host} wide={true} showSignOut={true} />

      <main class="sheet sheet-wide">
        {/* TOP BAR: WORKSPACE SWITCHER & USER BADGE */}
        <div
          style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.75rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border);"
        >
          {/* Workspace Switcher */}
          <div style="position: relative; display: flex; align-items: center; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.08em;">
                Workspace:
              </span>
              <div class="workspace-switcher-dropdown" style="position: relative;">
                <button
                  type="button"
                  id="workspaceSwitcherBtn"
                  data-action="toggle-ws-menu"
                  class="btn btn-secondary"
                  style="font-size: 0.875rem; padding: 0.45rem 0.85rem; height: auto;"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  <span style="display: flex; align-items: center; color: var(--primary);">
                    {isOrg ? <BuildingIcon size={16} /> : <UserIcon size={16} />}
                  </span>
                  <span style="font-weight: 600;">{props.activeWorkspace.name}</span>
                  <span class="badge-pill" style="font-size: 0.6875rem; padding: 0.05rem 0.4rem; text-transform: uppercase; font-weight: 700;">
                    {props.activeWorkspace.kind}
                  </span>
                  <ChevronDown size={14} />
                </button>

                {/* Dropdown Menu */}
                <div
                  id="workspaceDropdownMenu"
                  style="display: none; position: absolute; top: calc(100% + 8px); left: 0; min-width: 17rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.2), 0 0 0 1px var(--border); z-index: 50; padding: 0.5rem 0; overflow: hidden;"
                >
                  <div style="padding: 0.4rem 0.85rem; font-size: 0.6875rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.08em;">
                    Personal Workspaces
                  </div>
                  {props.workspaces
                    .filter((w) => w.kind === "personal")
                    .map((w) => (
                      <a
                        href={`/portal?ws=${w.id}`}
                        style={`display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.85rem; color: var(--foreground); text-decoration: none; font-size: 0.875rem; transition: background 120ms ease; ${w.id === props.activeWorkspace.id ? "background: var(--muted); font-weight: 600;" : ""}`}
                      >
                        <span style="display: flex; align-items: center; gap: 0.55rem;">
                          <UserIcon size={15} />
                          <span>{w.name}</span>
                        </span>
                        {w.id === props.activeWorkspace.id && (
                          <span style="color: #10b981; display: flex; align-items: center;">
                            <Check size={14} />
                          </span>
                        )}
                      </a>
                    ))}

                  <div style="height: 1px; background: var(--border); margin: 0.4rem 0;"></div>

                  <div style="padding: 0.4rem 0.85rem; font-size: 0.6875rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.08em;">
                    Team Organizations
                  </div>
                  {props.workspaces
                    .filter((w) => w.kind === "team")
                    .map((w) => (
                      <a
                        href={`/portal?ws=${w.id}`}
                        style={`display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.85rem; color: var(--foreground); text-decoration: none; font-size: 0.875rem; transition: background 120ms ease; ${w.id === props.activeWorkspace.id ? "background: var(--muted); font-weight: 600;" : ""}`}
                      >
                        <span style="display: flex; align-items: center; gap: 0.55rem;">
                          <BuildingIcon size={15} />
                          <span>{w.name}</span>
                        </span>
                        {w.id === props.activeWorkspace.id && (
                          <span style="color: #10b981; display: flex; align-items: center;">
                            <Check size={14} />
                          </span>
                        )}
                      </a>
                    ))}

                  <div style="height: 1px; background: var(--border); margin: 0.4rem 0;"></div>

                  <button
                    type="button"
                    data-action="open-create-org"
                    style="width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.85rem; background: none; border: none; color: var(--primary); font-size: 0.8125rem; font-weight: 600; cursor: pointer; text-align: left;"
                  >
                    <PlusIcon size={14} />
                    <span>Create Organization</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* User badge and actions */}
          <div style="display: flex; align-items: center; gap: 0.85rem;">
            <div style="text-align: right; display: flex; flex-direction: column; justify-content: center;">
              <div style="font-size: 0.875rem; font-weight: 600; color: var(--foreground); line-height: 1.2;">
                {props.user.displayName}
              </div>
              <div style="font-size: 0.75rem; color: var(--muted-foreground); line-height: 1.2; margin-top: 0.15rem;">
                {props.user.email}
              </div>
            </div>
            <button
              type="button"
              data-action="open-chatgpt-modal"
              class="btn btn-secondary"
              style="color: var(--primary); border-color: color-mix(in oklch, var(--primary) 25%, var(--border));"
            >
              <BotIcon size={15} />
              <span>Connect ChatGPT</span>
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
            style="display: flex; gap: 0.35rem; margin-bottom: 1.75rem; overflow-x: auto; padding-bottom: 0.35rem; border-bottom: 1px solid var(--border);"
          >
            {[
              { id: "overview", label: "Overview", icon: <SparklesIcon size={15} /> },
              { id: "members", label: `Members (${props.members?.length || 1})`, icon: <UsersIcon size={15} /> },
              { id: "mailboxes", label: `Mailboxes (${props.accounts.length})`, icon: <MailIcon size={15} /> },
              { id: "relay", label: "Proton Relay", icon: <ZapIcon size={15} /> },
              { id: "devices", label: `Bridge Devices (${devices.length})`, icon: <LaptopIcon size={15} /> },
              { id: "plan", label: "Plan & Security", icon: <ShieldCheckIcon size={15} /> },
            ].map((tab) => (
              <a
                href={`/portal?ws=${props.activeWorkspace.id}&tab=${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id ? "true" : "false"}
                style={`display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.95rem; border-radius: var(--radius-md) var(--radius-md) 0 0; text-decoration: none; font-size: 0.875rem; font-weight: 600; white-space: nowrap; transition: all 140ms ease; ${
                  activeTab === tab.id
                    ? "background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-bottom-color: var(--card); box-shadow: 0 -2px 6px rgba(0,0,0,0.03);"
                    : "color: var(--muted-foreground); border: 1px solid transparent;"
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
              style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 1.35rem 1.65rem; margin-bottom: 1.75rem; box-shadow: var(--shadow-xs);"
            >
              <div>
                <div class="badge-pill" style="margin-bottom: 0.5rem; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); color: #10b981;">
                  <ShieldCheckIcon size={13} />
                  <span>100% Human-Approved Outbound Protection</span>
                </div>
                <h2 style="font-size: 1.25rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--foreground); letter-spacing: -0.02em;">
                  Personal Mail Vault
                </h2>
                <p style="margin: 0; font-size: 0.875rem; color: var(--muted-foreground); max-width: 42rem;">
                  Connected accounts are synchronized directly to your personal vault with zero third-party leakage and mandatory approval for outgoing mail.
                </p>
              </div>
              <div style="display: flex; gap: 0.75rem; align-items: center;">
                <button
                  type="button"
                  data-action="open-create-org"
                  class="btn btn-secondary"
                  style="font-size: 0.8125rem;"
                >
                  <BuildingIcon size={15} />
                  <span>Create Organization &rarr;</span>
                </button>
              </div>
            </div>

            {/* SECTION 1: Connected Mailboxes */}
            <section class="card" style="margin-bottom: 1.75rem;">
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <span class="badge-pill" style="font-size: 0.75rem; font-weight: 700; background: var(--primary); color: var(--primary-foreground); border: none; width: 1.35rem; height: 1.35rem; padding: 0; justify-content: center;">
                      1
                    </span>
                    <h2 class="card-title">Connected Mailboxes ({props.accounts.length})</h2>
                  </div>
                  <p class="card-desc">Link your personal Gmail, Microsoft 365, or Proton accounts.</p>
                </div>
              </div>
              <div class="card-content">
                {props.accounts.length === 0 ? (
                  <div style="padding: 2.5rem 1.5rem; background: var(--muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); text-align: center; margin-bottom: 1.25rem;">
                    <div style="display: inline-flex; align-items: center; justify-content: center; width: 3rem; height: 3rem; border-radius: 50%; background: var(--secondary); margin-bottom: 0.75rem; color: var(--muted-foreground);">
                      <MailIcon size={24} />
                    </div>
                    <p style="margin: 0 0 0.35rem 0; font-size: 0.9375rem; font-weight: 600; color: var(--foreground);">
                      No mailboxes connected yet
                    </p>
                    <p style="margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); max-width: 24rem; margin: 0 auto;">
                      Connect your first email account below to start receiving conversational briefings and AI inbox control.
                    </p>
                  </div>
                ) : (
                  <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
                    {props.accounts.map((acc) => {
                      const statusBadge = formatMailboxStatusBadge(acc.status as any);
                      return (
                        <div
                          style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.875rem 1.15rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); transition: border-color 120ms ease;"
                        >
                          <div style="display: flex; align-items: center; gap: 0.85rem;">
                            {acc.provider === "gmail" ? (
                              <span class="badge-pill" style="background: rgba(234, 67, 53, 0.1); border-color: rgba(234, 67, 53, 0.25); color: #ea4335; font-weight: 700;">
                                <GoogleBrandIcon size={14} />
                                <span>GMAIL</span>
                              </span>
                            ) : acc.provider === "proton" ? (
                              <span class="badge-pill" style="background: rgba(109, 74, 255, 0.1); border-color: rgba(109, 74, 255, 0.25); color: #6d4aff; font-weight: 700;">
                                <ProtonBrandIcon size={14} />
                                <span>PROTON</span>
                              </span>
                            ) : (
                              <span class="badge-pill" style="background: rgba(0, 164, 239, 0.1); border-color: rgba(0, 164, 239, 0.25); color: #00a4ef; font-weight: 700;">
                                <MicrosoftBrandIcon size={14} />
                                <span>MICROSOFT</span>
                              </span>
                            )}
                            <div>
                              <div style="font-weight: 600; font-size: 0.9375rem; color: var(--foreground); line-height: 1.3;">
                                {acc.emailAddress}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.4rem; margin-top: 0.15rem;">
                                <span class="status-dot is-live" style={`background: ${statusBadge.dotColor};`}></span>
                                <span>{statusBadge.label}</span>
                              </div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <form method="post" action="/portal/accounts/sync" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn btn-secondary btn-sm"
                              >
                                <SyncIcon size={13} />
                                <span>Sync Now</span>
                              </button>
                            </form>

                            <form method="post" action="/portal/accounts/disconnect" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn btn-destructive btn-sm btn-confirm-delete"
                              >
                                <TrashIcon size={13} />
                                <span>Disconnect</span>
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Connect Provider Buttons */}
                <div style="display: flex; flex-wrap: wrap; gap: 0.75rem; padding-top: 0.85rem; border-top: 1px solid var(--border);">
                  {props.googleAuthUrl ? (
                    <a
                      href={props.googleAuthUrl}
                      class="provider-btn"
                    >
                      <GoogleBrandIcon size={16} />
                      <span>Connect Google / Gmail</span>
                    </a>
                  ) : (
                    <button
                      disabled
                      class="provider-btn"
                    >
                      <GoogleBrandIcon size={16} />
                      <span>Google (Configuring...)</span>
                    </button>
                  )}

                  {props.microsoftAuthUrl ? (
                    <a
                      href={props.microsoftAuthUrl}
                      class="provider-btn"
                    >
                      <MicrosoftBrandIcon size={16} />
                      <span>Connect Microsoft 365</span>
                    </a>
                  ) : (
                    <button
                      disabled
                      class="provider-btn"
                    >
                      <MicrosoftBrandIcon size={16} />
                      <span>Microsoft (Configuring...)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    data-action="open-proton-modal"
                    class="provider-btn"
                  >
                    <ProtonBrandIcon size={16} />
                    <span>Connect Proton Mail</span>
                  </button>
                </div>
              </div>
            </section>

            {/* SECTION 2: AI & MCP Access Tokens */}
            <section class="card" style="margin-bottom: 1.75rem;">
              <div class="card-header">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                  <span class="badge-pill" style="font-size: 0.75rem; font-weight: 700; background: var(--primary); color: var(--primary-foreground); border: none; width: 1.35rem; height: 1.35rem; padding: 0; justify-content: center;">
                    2
                  </span>
                  <h2 class="card-title">Connect Mailwarden to ChatGPT &amp; Claude</h2>
                </div>
                <p class="card-desc">Use the credentials below to add Mailwarden as a Custom MCP Tool in ChatGPT or Claude Desktop.</p>
              </div>
              <div class="card-content">
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                  {/* MCP Server URL */}
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                      <label for="mcpSseUrlInput" style="font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.06em;">
                        MCP Server URL (SSE)
                      </label>
                      <span class="badge-pill" style="font-size: 0.6875rem; padding: 0.05rem 0.35rem;">
                        SSE ENDPOINT
                      </span>
                    </div>
                    <div class="code-input-group">
                      <input
                        id="mcpSseUrlInput"
                        type="text"
                        readonly
                        value={`https://${props.host}/mcp/sse`}
                      />
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm btn-copy"
                        data-target="mcpSseUrlInput"
                        style="margin-right: 0.35rem;"
                      >
                        <CopyIcon size={13} />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>

                  {/* Vault Access Token */}
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                      <label for="vaultTokenInput" style="font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.06em;">
                        Vault Access Token (Bearer)
                      </label>
                      <span class="badge-pill" style="font-size: 0.6875rem; padding: 0.05rem 0.35rem;">
                        BEARER TOKEN
                      </span>
                    </div>
                    <div class="code-input-group">
                      <input
                        id="vaultTokenInput"
                        type="password"
                        readonly
                        value={props.token}
                      />
                      <div style="display: flex; gap: 0.35rem; margin-right: 0.35rem;">
                        <button
                          type="button"
                          class="btn btn-outline btn-sm"
                          data-action="toggle-token-visibility"
                          data-target="vaultTokenInput"
                          title="Show / Hide token"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm btn-copy"
                          data-target="vaultTokenInput"
                        >
                          <CopyIcon size={13} />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Setup Instructions Box */}
                <div style="margin-top: 1.25rem; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1rem 1.25rem;">
                  <div style="font-size: 0.8125rem; font-weight: 600; color: var(--foreground); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
                    <BotIcon size={15} />
                    <span>How to add Mailwarden to your AI assistant:</span>
                  </div>
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-top: 0.75rem;">
                    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.75rem;">
                      <div style="font-weight: 600; font-size: 0.8125rem; color: var(--foreground); margin-bottom: 0.25rem;">
                        ChatGPT Custom MCP
                      </div>
                      <p style="margin: 0; font-size: 0.75rem; color: var(--muted-foreground);">
                        Open <strong>Settings &rarr; Connected Apps &rarr; Add Custom MCP Tool</strong>. Paste the Server URL and Token above.
                      </p>
                    </div>
                    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.75rem;">
                      <div style="font-weight: 600; font-size: 0.8125rem; color: var(--foreground); margin-bottom: 0.25rem;">
                        Claude Desktop
                      </div>
                      <p style="margin: 0; font-size: 0.75rem; color: var(--muted-foreground);">
                        Add Mailwarden to your <code style="font-size: 0.7rem;">claude_desktop_config.json</code> under <code style="font-size: 0.7rem;">mcpServers</code> using SSE URL.
                      </p>
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
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.75rem;">
                  {/* Members Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-xs);">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                      Team Members
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {props.members?.length || 1}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=members`}
                      style="font-size: 0.8125rem; font-weight: 600; text-decoration: none;"
                    >
                      Manage Teammates &rarr;
                    </a>
                  </div>

                  {/* Mailboxes Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-xs);">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                      Organization Mailboxes
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {props.accounts.length}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=mailboxes`}
                      style="font-size: 0.8125rem; font-weight: 600; text-decoration: none;"
                    >
                      View Mailboxes &rarr;
                    </a>
                  </div>

                  {/* Proton Relay Status Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-xs);">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                      Proton Relay
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0;">
                      <span class="status-dot is-live" style={`background: ${relayBadge.dotColor};`}></span>
                      <span style="font-size: 1.25rem; font-weight: 700; color: var(--foreground);">
                        {relayBadge.label}
                      </span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--muted-foreground);">
                      {relay.activeDevicesCount} server device active
                    </div>
                  </div>

                  {/* Bridge Device Metric */}
                  <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-xs);">
                    <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                      Bridge Devices
                    </div>
                    <div style="font-size: 1.75rem; font-weight: 700; color: var(--foreground); margin: 0.25rem 0;">
                      {devices.length}
                    </div>
                    <a
                      href={`/portal?ws=${props.activeWorkspace.id}&tab=devices`}
                      style="font-size: 0.8125rem; font-weight: 600; text-decoration: none;"
                    >
                      View Devices &rarr;
                    </a>
                  </div>
                </div>

                {/* Relay Highlight Banner */}
                <div
                  style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 1.5rem; margin-bottom: 1.75rem; box-shadow: var(--shadow-xs);"
                >
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
                    <div>
                      <div class="badge-pill" style="background: rgba(109, 74, 255, 0.1); color: #6d4aff; border-color: rgba(109, 74, 255, 0.25); font-weight: 700; margin-bottom: 0.5rem;">
                        <ZapIcon size={13} />
                        <span>Shared Organization Relay</span>
                      </div>
                      <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0 0 0.35rem 0; color: var(--foreground);">
                        {props.activeWorkspace.name} is ready for Proton Mail
                      </h3>
                      <p style="margin: 0; font-size: 0.875rem; color: var(--muted-foreground); max-width: 38rem;">
                        All organization members can connect their individual Proton accounts with zero local bridge installation. Synchronization is managed automatically by your team relay.
                      </p>
                    </div>

                    <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
                      <button
                        type="button"
                        data-action="open-proton-modal"
                        class="btn btn-primary"
                      >
                        <PlusIcon size={14} />
                        <span>Connect Proton Account</span>
                      </button>
                      <button
                        type="button"
                        data-action="open-bridge-wizard"
                        class="btn btn-secondary"
                      >
                        <SettingsIcon size={14} />
                        <span>Relay Settings</span>
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
                    class="btn btn-primary btn-sm"
                  >
                    <PlusIcon size={13} />
                    <span>Invite Teammate</span>
                  </button>
                </div>
                <div class="card-content">
                  {props.createdOrgInviteUrl && (
                    <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-lg); padding: 1rem 1.25rem; margin-bottom: 1.5rem;">
                      <div style="font-weight: 600; font-size: 0.875rem; color: var(--primary); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
                        <Check size={14} />
                        <span>Teammate Invitation Created</span>
                      </div>
                      <div class="code-input-group">
                        <input
                          id="orgInviteInput"
                          type="text"
                          readonly
                          value={props.createdOrgInviteUrl}
                        />
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm btn-copy"
                          data-target="orgInviteInput"
                          style="margin-right: 0.35rem;"
                        >
                          <CopyIcon size={13} />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Members Table */}
                  <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
                      <thead>
                        <tr style="border-bottom: 1px solid var(--border); color: var(--muted-foreground); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
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
                                <span class="badge-pill" style={`background: ${roleInfo.badgeBg}; color: ${roleInfo.badgeColor}; border: none; font-weight: 700;`}>
                                  {roleInfo.label}
                                </span>
                              </td>
                              <td style="padding: 0.875rem 0.5rem;">
                                <span class="badge-pill" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: none;">
                                  <span class="status-dot is-live" style="background: #10b981;"></span>
                                  <span>Active</span>
                                </span>
                              </td>
                              <td style="padding: 0.875rem 0.5rem; text-align: right;">
                                {m.isSelf ? (
                                  <span style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 600;">You</span>
                                ) : (
                                  <form method="post" action="/portal/organizations/members/remove" style="display: inline;">
                                    <input type="hidden" name="orgId" value={props.activeWorkspace.id} />
                                    <input type="hidden" name="memberUserId" value={m.userId} />
                                    <button
                                      type="submit"
                                      class="btn btn-destructive btn-sm btn-confirm-delete"
                                    >
                                      <TrashIcon size={12} />
                                      <span>Remove</span>
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
                    class="btn btn-primary btn-sm"
                  >
                    <PlusIcon size={13} />
                    <span>Connect Proton Mailbox</span>
                  </button>
                </div>
                <div class="card-content">
                  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    {props.accounts.map((acc) => {
                      const statusBadge = formatMailboxStatusBadge(acc.status as any);
                      return (
                        <div
                          style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.875rem 1.15rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs);"
                        >
                          <div style="display: flex; align-items: center; gap: 0.85rem;">
                            {acc.provider === "gmail" ? (
                              <span class="badge-pill" style="background: rgba(234, 67, 53, 0.1); border-color: rgba(234, 67, 53, 0.25); color: #ea4335; font-weight: 700;">
                                <GoogleBrandIcon size={14} />
                                <span>GMAIL</span>
                              </span>
                            ) : acc.provider === "proton" ? (
                              <span class="badge-pill" style="background: rgba(109, 74, 255, 0.1); border-color: rgba(109, 74, 255, 0.25); color: #6d4aff; font-weight: 700;">
                                <ProtonBrandIcon size={14} />
                                <span>PROTON</span>
                              </span>
                            ) : (
                              <span class="badge-pill" style="background: rgba(0, 164, 239, 0.1); border-color: rgba(0, 164, 239, 0.25); color: #00a4ef; font-weight: 700;">
                                <MicrosoftBrandIcon size={14} />
                                <span>MICROSOFT</span>
                              </span>
                            )}
                            <div>
                              <div style="font-weight: 600; font-size: 0.9375rem; color: var(--foreground); line-height: 1.3;">
                                {acc.emailAddress}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.4rem; margin-top: 0.15rem;">
                                <span class="status-dot is-live" style={`background: ${statusBadge.dotColor};`}></span>
                                <span>{statusBadge.label}</span>
                              </div>
                            </div>
                          </div>

                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <form method="post" action="/portal/accounts/sync" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn btn-secondary btn-sm"
                              >
                                <SyncIcon size={13} />
                                <span>Sync Now</span>
                              </button>
                            </form>

                            <form method="post" action="/portal/accounts/disconnect" style="display: inline;">
                              <input type="hidden" name="accountId" value={acc.id} />
                              <button
                                type="submit"
                                class="btn btn-destructive btn-sm btn-confirm-delete"
                              >
                                <TrashIcon size={13} />
                                <span>Disconnect</span>
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
                      class="badge-pill"
                      style={`background: ${relayBadge.badgeBg}; color: ${relayBadge.badgeColor}; border-color: ${relayBadge.badgeBorder}; font-weight: 700;`}
                    >
                      <span class="status-dot is-live" style={`background: ${relayBadge.dotColor};`}></span>
                      <span>{relayBadge.label}</span>
                    </span>
                  </div>
                </div>
                <div class="card-content">
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.75rem;">
                    <div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                        Gateway Endpoint
                      </div>
                      <div style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--primary); margin-top: 0.35rem; word-break: break-all;">
                        {relayEndpoint || "Not reported yet"}
                      </div>
                    </div>

                    <div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                        Accounts Connected
                      </div>
                      <div style="font-size: 1.25rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {relay.connectedAccountsCount} active Proton accounts
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                    <button
                      type="button"
                      data-action="open-diagnostics"
                      class="btn btn-secondary"
                    >
                      <SearchIcon size={14} />
                      <span>Run Diagnostics</span>
                    </button>
                    <button
                      type="button"
                      data-action="open-bridge-wizard"
                      class="btn btn-secondary"
                    >
                      <SettingsIcon size={14} />
                      <span>Setup / Reconfigure Bridge</span>
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
                    class="btn btn-primary btn-sm"
                  >
                    <PlusIcon size={13} />
                    <span>Pair New Device</span>
                  </button>
                </div>
                <div class="card-content">
                  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    {devices.length === 0 && (
                      <div style="padding: 2.5rem 1.5rem; background: var(--muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); text-align: center;">
                        <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground);">
                          No Bridge devices yet
                        </div>
                        <div style="font-size: 0.8125rem; color: var(--muted-foreground); margin-top: 0.35rem;">
                          Install Mailwarden Bridge on the server that runs Proton Bridge, run
                          <code style="font-family: var(--font-mono);"> mailwarden-bridge setup</code>, then approve its code here.
                        </div>
                      </div>
                    )}
                    {devices.map((dev) => {
                      const devBadge = formatRelayStatusBadge(dev.status as any);
                      return (
                        <div
                          style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem 1.25rem; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs);"
                        >
                          <div style="display: flex; align-items: center; gap: 0.85rem;">
                            <div style="width: 2.5rem; height: 2.5rem; border-radius: var(--radius-md); background: var(--secondary); display: flex; align-items: center; justify-content: center; color: var(--foreground); flex: none;">
                              <LaptopIcon size={20} />
                            </div>
                            <div>
                              <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground);">
                                {dev.name}
                              </div>
                              <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.15rem;">
                                <span>{dev.platform}</span> &bull; <span>v{dev.version}</span> &bull;{" "}
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
                              class="badge-pill"
                              style={`background: ${devBadge.badgeBg}; color: ${devBadge.badgeColor}; border-color: ${devBadge.badgeBorder}; font-weight: 600;`}
                            >
                              <span class="status-dot is-live" style={`background: ${devBadge.dotColor};`}></span>
                              {devBadge.label}
                            </span>
                            <button
                              type="button"
                              data-action="open-diagnostics"
                              data-device={dev.id}
                              class="btn btn-secondary btn-sm"
                            >
                              <SearchIcon size={12} />
                              <span>Diagnostics</span>
                            </button>
                            <form method="post" action="/portal/organizations/devices/revoke" style="display: inline;">
                              <input type="hidden" name="orgId" value={props.activeWorkspace.id} />
                              <input type="hidden" name="deviceId" value={dev.id} />
                              <button
                                type="submit"
                                class="btn btn-destructive btn-sm btn-confirm-delete"
                              >
                                <TrashIcon size={12} />
                                <span>Revoke</span>
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
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.75rem;">
                    <div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                        Seats
                      </div>
                      <div style="font-size: 1.35rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {props.members?.length || 1} / {props.planCapabilities?.maxOrganizationSeats || 10} seats used
                      </div>
                    </div>

                    <div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                        Bridge Devices
                      </div>
                      <div style="font-size: 1.35rem; font-weight: 700; color: var(--foreground); margin-top: 0.25rem;">
                        {devices.length} / {props.planCapabilities?.maxRelayDevices || 3} relays active
                      </div>
                    </div>

                    <div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                      <div style="font-size: 0.75rem; color: var(--muted-foreground); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                        Shared Proton Relay
                      </div>
                      <div style="font-size: 1.35rem; font-weight: 700; color: #10b981; margin-top: 0.25rem; display: flex; align-items: center; gap: 0.4rem;">
                        <Check size={18} />
                        <span>Active &bull; Unlimited</span>
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
          style="display: none;"
        >
          <div class="modal-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
                <BuildingIcon size={18} />
                <span>Create Organization</span>
              </h3>
              <button
                type="button"
                data-action="close-create-org"
                style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer; padding: 0.2rem;"
              >
                &times;
              </button>
            </div>
            <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
              Organizations let you invite teammates, share a centralized Proton Relay, and manage company mailboxes.
            </p>

            <form method="post" action="/portal/organizations/create">
              <div style="margin-bottom: 1.25rem;">
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

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button
                  type="button"
                  data-action="close-create-org"
                  class="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn btn-primary"
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
          style="display: none;"
        >
          <div class="modal-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
                <UsersIcon size={18} />
                <span>Invite Teammate to {props.activeWorkspace.name}</span>
              </h3>
              <button
                type="button"
                data-action="close-invite-member"
                style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer; padding: 0.2rem;"
              >
                &times;
              </button>
            </div>
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

              <div style="margin-bottom: 1.25rem;">
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

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button
                  type="button"
                  data-action="close-invite-member"
                  class="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn btn-primary"
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
          style="display: none;"
        >
          <div class="modal-box" style="max-width: 34rem; max-height: 90vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h3 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
                <ServerIcon size={20} />
                <span>Set Up Mailwarden Bridge</span>
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
                style="border: 2px solid var(--primary); background: var(--muted); border-radius: var(--radius-lg); padding: 1.15rem;"
              >
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                  <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground); display: flex; align-items: center; gap: 0.4rem;">
                    <ServerIcon size={16} />
                    <span>Company Server (Recommended for Teams)</span>
                  </div>
                  <span class="badge-pill" style="font-size: 0.6875rem; background: var(--primary); color: var(--primary-foreground); border: none; font-weight: 700;">
                    24/7 SYNC
                  </span>
                </div>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 0.75rem 0;">
                  A central Linux server (AlmaLinux, Debian, Ubuntu) keeps Proton accounts syncing continuously even when employee laptops are turned off.
                </p>
                <div style="font-family: var(--font-mono); font-size: 0.75rem; background: var(--card); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); color: var(--foreground); border: 1px solid var(--border);">
                  curl -fsSL https://mailwarden.dev/install-bridge.sh | bash
                </div>
              </div>

              {/* Option B: Desktop */}
              <div
                style="border: 1px solid var(--border); background: var(--card); border-radius: var(--radius-lg); padding: 1.15rem;"
              >
                <div style="font-weight: 700; font-size: 0.9375rem; color: var(--foreground); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
                  <LaptopIcon size={16} />
                  <span>This Computer (Desktop App)</span>
                </div>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 0.75rem 0;">
                  Mailwarden Bridge runs in the background on this computer. Synchronization is active whenever this computer is online.
                </p>
                <button
                  type="button"
                  data-action="download-desktop"
                  class="btn btn-secondary btn-sm"
                >
                  <LaptopIcon size={13} />
                  <span>Download Mailwarden Desktop Companion &rarr;</span>
                </button>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button
                type="button"
                data-action="close-bridge-wizard"
                class="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>

        {/* MODAL 4: Diagnostics & Safe Repair */}
        {devices.map((dev) => {
          const health = dev.health;
          const controllable = Boolean(health?.endpoint) && !dev.revokedAt;
          return (
            <div
              id={`diagnosticsModal_${dev.id}`}
              class="modal-backdrop"
              style="display: none;"
            >
              <div class="modal-box" style="max-width: 32rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                  <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.45rem;">
                    <SearchIcon size={18} />
                    <span>{dev.name}</span>
                  </h3>
                  <button
                    type="button"
                    data-action="close-diagnostics"
                    data-device={dev.id}
                    style="background: none; border: none; color: var(--muted-foreground); font-size: 1.25rem; cursor: pointer;"
                  >
                    &times;
                  </button>
                </div>
                <p style="font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 1.25rem 0;">
                  {health
                    ? `Reported by the device at ${new Date(health.observedAt).toUTCString()}.`
                    : "This device has not reported health yet. It reports on its first heartbeat."}
                </p>

                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
                  {(health?.components || []).map((component) => (
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.65rem 0.85rem; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-md);">
                      <span style="font-size: 0.8125rem; font-weight: 600; text-transform: capitalize;">
                        {component.component}
                      </span>
                      <span
                        style={`font-size: 0.75rem; font-weight: 600; text-align: right; color: ${
                          component.status === "ok"
                            ? "#10b981"
                            : component.status === "degraded" || component.status === "needs_attention"
                              ? "#eab308"
                              : component.status === "down"
                                ? "#ef4444"
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
                        class="btn btn-secondary btn-sm"
                      >
                        <ZapIcon size={12} />
                        <span>Run repair</span>
                      </button>
                    </form>
                  ) : (
                    <span style="font-size: 0.75rem; color: var(--muted-foreground); max-width: 22rem;">
                      Remote repair needs a reachable relay endpoint. Run{" "}
                      <code style="font-family: var(--font-mono);">mailwarden-bridge doctor</code> on the device itself.
                    </span>
                  )}

                  <button
                    type="button"
                    data-action="close-diagnostics"
                    data-device={dev.id}
                    class="btn btn-primary btn-sm"
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
          style="display: none;"
        >
          <div class="modal-box">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
                <ProtonBrandIcon size={18} />
                <span>Connect Proton Mailbox</span>
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
                <p style="font-size: 0.8125rem; color: #eab308; margin: 0 0 1rem 0; background: rgba(234, 179, 8, 0.1); padding: 0.65rem 0.85rem; border-radius: var(--radius-md); border: 1px solid rgba(234, 179, 8, 0.25);">
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

              <div style="margin-bottom: 1.25rem;">
                <label for="bridgePasswordInput" style="display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--foreground);">
                  16-Character Bridge Password
                </label>
                <input
                  type="password"
                  id="bridgePasswordInput"
                  name="bridgePassword"
                  placeholder="e.g. abcd-efgh-ijkl-mnop"
                  required
                  style="width: 100%; box-sizing: border-box; background: var(--input); color: var(--foreground); border: 1px solid var(--border); padding: 0.55rem 0.75rem; border-radius: var(--radius-md); font-size: 0.875rem; font-family: var(--font-mono);"
                />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                <button
                  type="button"
                  data-action="close-proton-modal"
                  class="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn btn-primary"
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
          style="display: none;"
        >
          <div class="modal-box" style="max-width: 32rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <h3 style="font-size: 1.125rem; font-weight: 700; margin: 0; color: var(--foreground); display: flex; align-items: center; gap: 0.5rem;">
                <BotIcon size={18} />
                <span>Connect Mailwarden to ChatGPT</span>
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
              In ChatGPT, navigate to <strong>Settings &rarr; Connected Apps &rarr; Add Custom MCP Tool</strong>, then paste these credentials:
            </p>

            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                  <label for="chatGptSseUrl" style="font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.06em;">
                    Server URL (SSE)
                  </label>
                  <span class="badge-pill" style="font-size: 0.6875rem; padding: 0.05rem 0.35rem;">SSE</span>
                </div>
                <div class="code-input-group">
                  <input
                    id="chatGptSseUrl"
                    type="text"
                    readonly
                    value={`https://${props.host}/mcp/sse`}
                  />
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm btn-copy"
                    data-target="chatGptSseUrl"
                    style="margin-right: 0.35rem;"
                  >
                    <CopyIcon size={13} />
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                  <label for="chatGptToken" style="font-size: 0.75rem; font-weight: 700; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.06em;">
                    Bearer Token
                  </label>
                  <span class="badge-pill" style="font-size: 0.6875rem; padding: 0.05rem 0.35rem;">BEARER</span>
                </div>
                <div class="code-input-group">
                  <input
                    id="chatGptToken"
                    type="password"
                    readonly
                    value={props.token}
                  />
                  <div style="display: flex; gap: 0.35rem; margin-right: 0.35rem;">
                    <button
                      type="button"
                      class="btn btn-outline btn-sm"
                      data-action="toggle-token-visibility"
                      data-target="chatGptToken"
                      title="Show / Hide token"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm btn-copy"
                      data-target="chatGptToken"
                    >
                      <CopyIcon size={13} />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button
                type="button"
                data-action="close-chatgpt-modal"
                class="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>

        {/* JAVASCRIPT LOGIC VIA EVENT DELEGATION */}
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
            } else if (action === 'toggle-token-visibility') {
              var targetInputId = target.getAttribute('data-target');
              var inp = document.getElementById(targetInputId);
              if (inp) {
                inp.type = inp.type === 'password' ? 'text' : 'password';
              }
            }

            // Copy handler with visual feedback
            var copyBtn = e.target.closest('.btn-copy');
            if (copyBtn) {
              var targetId = copyBtn.getAttribute('data-target');
              var input = document.getElementById(targetId);
              if (input) {
                navigator.clipboard.writeText(input.value);
                var originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = '<span>✓ Copied!</span>';
                copyBtn.style.color = '#10b981';
                copyBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                setTimeout(function() {
                  copyBtn.innerHTML = originalHtml;
                  copyBtn.style.color = '';
                  copyBtn.style.borderColor = '';
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
              if (!confirm('Are you sure you want to proceed with this action?')) {
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
