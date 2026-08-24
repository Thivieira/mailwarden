import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authService } from "../../services/auth";
import { userAuthService } from "../../services/user-auth";
import { inviteService } from "../../services/invites";
import { privacyService } from "../../services/privacy";
import { providerOAuthService } from "../../services/provider-oauth";
import { encryptionService } from "../../services/encryption";
import { syncService } from "../../services/sync";
import { humanSessionService, readHumanSessionCookie } from "../../services/human-session";
import {
  workspaceService,
  organizationMemberService,
  relayAndDeviceService,
  organizationMailboxService,
  planService,
} from "../../services/portal-services";
import { db, schema } from "../../db";
import { config } from "../../config";
import { readBody, type Env } from "../context";
import { renderPage } from "../../ui/render";
import { PortalLandingPage, PortalDashboardPage } from "../../ui/portal.gen.js";
import { ALL_SCOPES, type AuthPrincipal } from "../../types/auth";
import { organizationService } from "../../services/organizations";
import { AuthorizationError } from "../../utils/errors";
import { BRIDGE_REPAIR_ACTIONS, type BridgeRepairAction } from "@mailwarden/contracts";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function getSessionUser(c: any): Promise<{ user: any; principal: AuthPrincipal; token: string } | null> {
  const cookieHeader = c.req.header("cookie") || "";
  let principal: AuthPrincipal | null = null;
  let tokenStr = "";

  const match = cookieHeader.match(/mw_token=([^;]+)/);
  if (match) {
    tokenStr = decodeURIComponent(match[1]);
    try {
      principal = await authService.verifyToken(tokenStr);
    } catch {}
  }

  if (!principal) {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      tokenStr = authHeader.slice(7);
      try {
        principal = await authService.verifyToken(tokenStr);
      } catch {}
    }
  }

  if (!principal) {
    const humanToken = readHumanSessionCookie(cookieHeader);
    if (humanToken) {
      try {
        const sessionUser = await humanSessionService.verify(humanToken);
        if (sessionUser) {
          principal = {
            tenantId: sessionUser.tenantId,
            userId: sessionUser.userId,
            scopes: ALL_SCOPES,
          };
          tokenStr = humanToken;
        }
      } catch {}
    }
  }

  if (!principal) return null;

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, principal.userId))
    .limit(1);

  if (!user) return null;
  return { user, principal, token: tokenStr };
}

export const portalRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const wantsHtml = (c.req.header("accept") || "").includes("text/html");
    if (!wantsHtml) {
      return c.json({
        name: "Mailwarden",
        tagline: "Your email, managed through normal conversation.",
        status: "online",
        portal: "/portal",
        documentation: "/swagger",
        mcpEndpoint: "/mcp",
        rpcEndpoint: "/mcp/rpc",
        sseEndpoint: "/mcp/sse",
        healthCheck: "/health",
      });
    }

    const session = await getSessionUser(c);
    const inviteCode = c.req.query("invite");
    const hasUsers = await inviteService.hasAnyUsers();
    const isLoggedOut = Boolean(c.req.query("logged_out"));

    return renderPage(
      "Mailwarden — Conversational Email Layer",
      () =>
        PortalLandingPage({
          host: hostOf(config.APP_BASE_URL),
          mode: (inviteCode || !hasUsers) ? "signup" : "login",
          inviteCode,
          isPrivateBeta: hasUsers,
          success: isLoggedOut ? "You have been signed out successfully." : undefined,
          loggedInUser: session ? { email: session.user.email, displayName: session.user.displayName } : undefined,
        }),
      200,
      { peek: true }
    );
  })

  .get("/portal/login", async (c) => {
    const session = await getSessionUser(c);
    if (session) return c.redirect("/portal");

    return renderPage(
      "Sign in — Mailwarden",
      () => PortalLandingPage({ host: hostOf(config.APP_BASE_URL), mode: "login" }),
      200,
      { peek: true }
    );
  })

  .get("/portal/signup", async (c) => {
    const session = await getSessionUser(c);
    if (session) return c.redirect("/portal");

    const inviteCode = c.req.query("invite");
    const hasUsers = await inviteService.hasAnyUsers();

    return renderPage(
      "Create Vault — Mailwarden",
      () =>
        PortalLandingPage({
          host: hostOf(config.APP_BASE_URL),
          mode: "signup",
          inviteCode,
          isPrivateBeta: hasUsers,
        }),
      200,
      { peek: true }
    );
  })

  .post("/portal/auth/login", async (c) => {
    const body = await readBody(c);
    try {
      const email = body.email || "";
      const password = body.password || body.login_secret || "";
      const user = await userAuthService.authenticateUser(email, password);
      const tokenData = await authService.createToken({
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      }, undefined, "30d");

      c.header(
        "Set-Cookie",
        `mw_token=${encodeURIComponent(tokenData.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      );
      return c.redirect("/portal");
    } catch (err: any) {
      return renderPage(
        "Sign in — Mailwarden",
        () =>
          PortalLandingPage({
            host: hostOf(config.APP_BASE_URL),
            mode: "login",
            error: err.message || "Invalid credentials",
          }),
        400,
        { peek: true }
      );
    }
  })

  .post("/portal/auth/signup", async (c) => {
    const body = await readBody(c);
    const inviteCode = body.invite || body.inviteCode;
    const hasUsers = await inviteService.hasAnyUsers();

    try {
      const email = body.email || "";
      const password = body.password || "";
      const displayName = body.displayName || "";
      const result = await userAuthService.registerUser({
        email,
        password,
        displayName,
        inviteCode,
        organizationInviteToken: body.organizationInviteToken || body.organization_invite,
      });

      c.header(
        "Set-Cookie",
        `mw_token=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      );
      return c.redirect("/portal");
    } catch (err: any) {
      return renderPage(
        "Create Vault — Mailwarden",
        () =>
          PortalLandingPage({
            host: hostOf(config.APP_BASE_URL),
            mode: "signup",
            inviteCode,
            isPrivateBeta: hasUsers,
            error: err.message || "Registration failed",
          }),
        400,
        { peek: true }
      );
    }
  })

  // ==========================================
  // ORGANIZATIONS & MEMBERS ROUTES
  // ==========================================

  .post("/portal/organizations/create", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const name = String(body.name || "").trim();
      const { organization } = await workspaceService.createOrganization(session.principal, { name });
      return c.redirect(`/portal?ws=${encodeURIComponent(organization.id)}&connected=Organization%20Created`);
    } catch (err: any) {
      return c.redirect(`/portal?error=${encodeURIComponent(err.message || "Failed to create organization")}`);
    }
  })

  .post("/portal/organizations/invites/create", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const orgId = String(body.orgId || "").trim();
      const email = String(body.email || "").trim();
      const role = body.role === "admin" ? "admin" : "member";

      const invite = await organizationMemberService.inviteMember(session.principal, orgId, { email, role });
      return c.redirect(
        `/portal?ws=${encodeURIComponent(orgId)}&tab=members&created_org_invite=${encodeURIComponent(invite.inviteUrl)}`
      );
    } catch (err: any) {
      const orgId = c.req.query("ws") || "";
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=members&error=${encodeURIComponent(err.message || "Failed to invite teammate")}`);
    }
  })

  .post("/portal/organizations/members/remove", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const orgId = String(body.orgId || "").trim();
      const memberUserId = String(body.memberUserId || "").trim();

      await organizationMemberService.removeMember(session.principal, orgId, memberUserId);
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=members&disconnected=Member%20Removed`);
    } catch (err: any) {
      const orgId = c.req.query("ws") || "";
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=members&error=${encodeURIComponent(err.message || "Failed to remove member")}`);
    }
  })

  .post("/portal/organizations/devices/revoke", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const orgId = String(body.orgId || "").trim();
      const deviceId = String(body.deviceId || "").trim();

      await relayAndDeviceService.revokeDevice(session.principal, orgId, deviceId);
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=devices&disconnected=Device%20Revoked`);
    } catch (err: any) {
      const orgId = c.req.query("ws") || "";
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=devices&error=${encodeURIComponent(err.message || "Failed to revoke device")}`);
    }
  })

  .post("/portal/organizations/relay/repair", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const orgId = String(body.orgId || "").trim();
      const deviceId = String(body.deviceId || "").trim();
      const action = String(body.actionId || "").trim() as BridgeRepairAction;
      if (!BRIDGE_REPAIR_ACTIONS.includes(action)) throw new Error("Unknown repair action");

      const result = await relayAndDeviceService.executeSafeRepair(session.principal, orgId, deviceId, action);
      const outcome = `${result.applied ? "Repaired" : "Not repaired"}: ${result.detail}`;
      const key = result.applied ? "connected" : "error";
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=devices&${key}=${encodeURIComponent(outcome)}`);
    } catch (err: any) {
      const orgId = c.req.query("ws") || "";
      return c.redirect(`/portal?ws=${encodeURIComponent(orgId)}&tab=relay&error=${encodeURIComponent(err.message || "Repair action failed")}`);
    }
  })

  // ==========================================
  // MAILBOX ACTIONS
  // ==========================================

  .post("/portal/invites/create", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const email = body.email ? String(body.email).trim() : undefined;
      const days = body.expiresInDays ? Number(body.expiresInDays) : 7;

      const invite = await inviteService.createInvite({
        createdByUserId: session.principal.userId,
        email,
        expiresInDays: days,
      });

      return c.redirect(`/portal?created_invite=${encodeURIComponent(invite.inviteUrl)}`);
    } catch {
      return c.redirect("/portal");
    }
  })

  .post("/portal/accounts/disconnect", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const accountId = body.accountId;

      if (accountId) {
        const [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, accountId)).limit(1);
        if (!account) return c.redirect("/portal");
        const context = await organizationService.requireWorkspaceMembership(session.principal, account.tenantId);
        if (context.workspace.kind === "team") {
          await organizationService.requireWorkspaceMembership(session.principal, account.tenantId, "admin");
        }
        const workspacePrincipal = { ...session.principal, workspaceId: account.tenantId, tenantId: account.tenantId };
        try {
          await privacyService.disconnectAccount(workspacePrincipal, accountId);
        } catch {}

        await db.delete(schema.emails).where(
          and(
            eq(schema.emails.accountId, accountId),
            eq(schema.emails.tenantId, account.tenantId)
          )
        );
        await db.delete(schema.emailIdentities).where(
          and(
            eq(schema.emailIdentities.accountId, accountId),
            eq(schema.emailIdentities.tenantId, account.tenantId)
          )
        );
        await db.delete(schema.emailAccounts).where(
          and(
            eq(schema.emailAccounts.id, accountId),
            eq(schema.emailAccounts.tenantId, account.tenantId)
          )
        );
      }

      return c.redirect("/portal?disconnected=1");
    } catch {
      return c.redirect("/portal");
    }
  })

  .post("/portal/accounts/sync", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const accountId = body.accountId;

      if (accountId) {
        const [account] = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.id, accountId)).limit(1);
        if (!account) return c.redirect("/portal");
        await organizationService.requireWorkspaceMembership(session.principal, account.tenantId);
        await syncService.syncAccount({ ...session.principal, workspaceId: account.tenantId, tenantId: account.tenantId }, accountId, 25);
        return c.redirect(`/portal?synced=1`);
      }
    } catch (err: any) {
      return c.redirect(`/portal?error=${encodeURIComponent(err.message || "Sync failed")}`);
    }

    return c.redirect("/portal");
  })

  .post("/portal/accounts/connect-proton", async (c) => {
    const session = await getSessionUser(c);
    if (!session) return c.redirect("/portal/login");

    try {
      const body = await readBody(c);
      const emailAddress = String(body.emailAddress || body.bridgeUsername || "").trim().toLowerCase();
      if (!emailAddress || !emailAddress.includes("@")) {
        return c.redirect("/portal?error=Invalid%20Proton%20email%20address");
      }

      const workspaceId = String(body.workspaceId || session.principal.tenantId).trim();
      await organizationService.requireWorkspaceMembership(session.principal, workspaceId);
      const workspacePrincipal = { ...session.principal, workspaceId, tenantId: workspaceId };
      const mode = body.mode === "direct" ? "direct" : "gateway";
      const gatewayUrl = body.gatewayUrl ? String(body.gatewayUrl).trim().replace(/\/+$/, "") : "http://localhost:8788";
      const gatewayApiKey = body.gatewayApiKey ? String(body.gatewayApiKey).trim() : undefined;
      const bridgeUsername = body.bridgeUsername ? String(body.bridgeUsername).trim() : emailAddress;
      const bridgePassword = body.bridgePassword ? String(body.bridgePassword).trim() : undefined;

      const creds = {
        mode,
        gatewayUrl,
        gatewayApiKey,
        bridgeUsername,
        bridgePassword,
        imapHost: "127.0.0.1",
        imapPort: 1143,
        smtpHost: "127.0.0.1",
        smtpPort: 1025,
      };

      const now = new Date();

      const [existingAcc] = await db
        .select()
        .from(schema.emailAccounts)
        .where(
          and(
            eq(schema.emailAccounts.tenantId, workspaceId),
            eq(schema.emailAccounts.emailAddress, emailAddress)
          )
        )
        .limit(1);

      const targetAccountId = existingAcc ? existingAcc.id : nanoid();
      if (existingAcc && existingAcc.userId !== session.principal.userId) {
        throw new AuthorizationError("This organization mailbox is already connected by another member");
      }

      if (existingAcc) {
        await db
          .update(schema.emailAccounts)
          .set({
            provider: "proton",
            displayName: emailAddress.split("@")[0] || "Proton",
            status: "connected",
            errorMessage: null,
            updatedAt: now,
          })
          .where(eq(schema.emailAccounts.id, existingAcc.id));
      } else {
        await organizationService.requireMailboxCapacity(workspacePrincipal, workspaceId);
        await db.insert(schema.emailAccounts).values({
          id: targetAccountId,
          tenantId: workspaceId,
          userId: session.principal.userId,
          provider: "proton",
          displayName: emailAddress.split("@")[0] || "Proton",
          emailAddress,
          status: "connected",
          priorityRole: "personal",
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(schema.emailIdentities).values({
          id: nanoid(),
          tenantId: workspaceId,
          userId: session.principal.userId,
          accountId: targetAccountId,
          email: emailAddress,
          displayName: emailAddress.split("@")[0] || "Proton",
          canSend: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      const encryptedCreds = encryptionService.encryptJson(creds, {
        tenantId: workspaceId,
        userId: session.principal.userId,
      });

      const [existingConn] = await db
        .select()
        .from(schema.providerConnections)
        .where(eq(schema.providerConnections.accountId, targetAccountId))
        .limit(1);

      if (existingConn) {
        await db
          .update(schema.providerConnections)
          .set({
            provider: "proton",
            encryptedCredentials: encryptedCreds,
            keyVersion: config.KEY_VERSION,
            updatedAt: now,
          })
          .where(eq(schema.providerConnections.id, existingConn.id));
      } else {
        await db.insert(schema.providerConnections).values({
          id: nanoid(),
          tenantId: workspaceId,
          userId: session.principal.userId,
          accountId: targetAccountId,
          provider: "proton",
          encryptedCredentials: encryptedCreds,
          keyVersion: config.KEY_VERSION,
          createdAt: now,
          updatedAt: now,
        });
      }

      try {
        await syncService.syncAccount(workspacePrincipal, targetAccountId, 25);
      } catch {}

      return c.redirect(`/portal?ws=${encodeURIComponent(workspaceId)}&connected=Proton%20Mail&email=${encodeURIComponent(emailAddress)}`);
    } catch (err: any) {
      return c.redirect(`/portal?error=${encodeURIComponent(err.message || "Failed to link Proton account")}`);
    }
  })

  // ==========================================
  // PORTAL DASHBOARD (MAIN VIEW)
  // ==========================================

  .get("/portal", async (c) => {
    const session = await getSessionUser(c);
    if (!session) {
      return c.redirect("/portal/login");
    }

    try {
      const { user, principal, token } = session;

      const requestedWsId = c.req.query("ws");
      const currentTab = (c.req.query("tab") as any) || "overview";

      const workspaces = await workspaceService.listWorkspaces(principal);
      const activeContext = await workspaceService.getActiveWorkspace(principal, requestedWsId);
      const activeWorkspace = {
        id: activeContext.workspace.id,
        name: activeContext.workspace.name,
        kind: activeContext.workspace.kind,
        role: activeContext.membership.role,
      };

      const isOrg = activeWorkspace.kind === "team";
      const activePrincipal = { ...principal, workspaceId: activeWorkspace.id, tenantId: activeWorkspace.id };

      // Fetch accounts scoped to active workspace
      const accounts = await db
        .select({
          id: schema.emailAccounts.id,
          provider: schema.emailAccounts.provider,
          emailAddress: schema.emailAccounts.emailAddress,
          displayName: schema.emailAccounts.displayName,
          status: schema.emailAccounts.status,
          priorityRole: schema.emailAccounts.priorityRole,
        })
        .from(schema.emailAccounts)
        .where(isOrg
          ? eq(schema.emailAccounts.tenantId, activeWorkspace.id)
          : and(eq(schema.emailAccounts.tenantId, activeWorkspace.id), eq(schema.emailAccounts.userId, principal.userId)));

      let googleAuthUrl: string | undefined;
      let microsoftAuthUrl: string | undefined;

      try {
        const gRes = await providerOAuthService.buildAuthorizationUrl(activePrincipal, "gmail", "full");
        googleAuthUrl = gRes.authUrl;
      } catch {}

      try {
        const mRes = await providerOAuthService.buildAuthorizationUrl(activePrincipal, "outlook", "full");
        microsoftAuthUrl = mRes.authUrl;
      } catch {}

      const invites = await inviteService.listInvites(principal.userId);
      const createdInviteUrl = c.req.query("created_invite");
      const createdOrgInviteUrl = c.req.query("created_org_invite");
      const connectedProvider = c.req.query("connected");
      const connectedEmail = c.req.query("email");
      const isDisconnected = c.req.query("disconnected");
      const isSynced = c.req.query("synced");
      const errorMsg = c.req.query("error");

      let connectedMessage: string | undefined;
      if (connectedProvider) {
        connectedMessage = `${connectedProvider.toUpperCase()} connected successfully${connectedEmail ? ` (${connectedEmail})` : ""}! Initial background sync started.`;
      } else if (isSynced) {
        connectedMessage = "Account synchronization completed successfully!";
      }

      let disconnectedMessage: string | undefined;
      if (isDisconnected) {
        disconnectedMessage = "Email account disconnected and removed successfully.";
      }

      // Organization-specific data
      let members: any[] = [];
      let relayStatus: any = undefined;
      let relayDevices: any[] = [];
      let planCapabilities: any = undefined;

      if (isOrg) {
        members = await organizationMemberService.listMembers(principal, activeWorkspace.id);
        relayStatus = await relayAndDeviceService.getRelayStatus(principal, activeWorkspace.id);
        relayDevices = await relayAndDeviceService.listRelayDevices(principal, activeWorkspace.id);
        planCapabilities = await planService.getCapabilities(principal, activeWorkspace.id);
      }

      return renderPage(
        `${activeWorkspace.name} — Mailwarden`,
        () =>
          PortalDashboardPage({
            host: hostOf(config.APP_BASE_URL),
            user: {
              displayName: user.displayName || user.email.split("@")[0] || "Owner",
              email: user.email,
              tenantId: user.tenantId,
              role: user.role,
            },
            token,
            activeWorkspace,
            workspaces,
            currentTab,
            accounts: accounts as any,
            googleAuthUrl,
            microsoftAuthUrl,
            dryRun: !config.MAILBOX_MUTATIONS_ENABLED,
            invites,
            createdInviteUrl,
            createdOrgInviteUrl,
            connectedMessage,
            disconnectedMessage: disconnectedMessage || (errorMsg ? `Error: ${errorMsg}` : undefined),
            members,
            relayStatus,
            relayDevices,
            planCapabilities,
          }),
        200,
        { allowScripts: true }
      );
    } catch {
      return c.redirect("/portal/login");
    }
  })

  .get("/portal/logout", (c) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/?logged_out=1",
        "Set-Cookie": "mw_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    });
  })

  .post("/portal/auth/logout", (c) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/?logged_out=1",
        "Set-Cookie": "mw_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    });
  })

  .get("/logout", (c) => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/?logged_out=1",
        "Set-Cookie": "mw_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    });
  });
