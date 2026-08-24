import { describe, expect, test, beforeEach } from "bun:test";
import {
  workspaceService,
  organizationMemberService,
  relayAndDeviceService,
  organizationMailboxService,
  planService,
} from "../src/services/portal-services";
import { mapRawErrorToDiagnostic, formatRelayStatusBadge, formatMembershipRole } from "@mailwarden/ui";
import { userAuthService } from "../src/services/user-auth";
import { ALL_SCOPES, type AuthPrincipal } from "../src/types/auth";
import { nanoid } from "nanoid";

import { inviteService } from "../src/services/invites";
import { relayDeviceService } from "../src/services/relay-devices";

process.env.RELAY_PROVISIONING_STARTS_PER_MINUTE ||= "10000";

describe("Mailwarden Organizations, Portal & Product Experience", () => {
  let principal: AuthPrincipal;

  beforeEach(async () => {
    const inv = await inviteService.createInvite({ expiresInDays: 7 });
    const userEmail = `product_test_${nanoid(8)}@foxdevstudio.com`;
    const reg = await userAuthService.registerUser({
      email: userEmail,
      password: "TestPassword123!",
      displayName: "Thiago",
      inviteCode: inv.code,
    });

    principal = {
      tenantId: reg.user.tenantId,
      userId: reg.user.id,
      scopes: ALL_SCOPES,
    };
  });

  // 1. Workspace Switcher & Personal vs Team Isolation
  test("Workspace Switcher lists Personal Workspace and handles active selection", async () => {
    const workspaces = await workspaceService.listWorkspaces(principal);
    expect(workspaces.length).toBeGreaterThanOrEqual(1);

    const personal = workspaces.find((w) => w.kind === "personal");
    expect(personal).toBeDefined();
    expect(personal?.name).toBe("Personal Workspace");

    const activeCtx = await workspaceService.getActiveWorkspace(principal, personal!.id);
    expect(activeCtx.workspace.id).toBe(personal!.id);
    expect(activeCtx.membership.role).toBe("owner");
  });

  // 2. Create Organization Flow
  test("Creates Team Organization and sets creator as Owner", async () => {
    const { organization, context } = await workspaceService.createOrganization(principal, {
      name: "FoxDevStudio",
    });

    expect(organization.name).toBe("FoxDevStudio");
    expect(organization.kind).toBe("team");
    expect(context.membership.role).toBe("owner");

    // List workspaces again -> shows both Personal and FoxDevStudio
    const updated = await workspaceService.listWorkspaces(principal);
    const orgFound = updated.find((w) => w.id === organization.id);
    expect(orgFound).toBeDefined();
    expect(orgFound?.name).toBe("FoxDevStudio");
    expect(orgFound?.kind).toBe("team");
  });

  test("Validates organization name constraints", async () => {
    await expect(
      workspaceService.createOrganization(principal, { name: "A" })
    ).rejects.toThrow("Organization name must be at least 2 characters long");

    await expect(
      workspaceService.createOrganization(principal, { name: "   " })
    ).rejects.toThrow("Organization name must be at least 2 characters long");
  });

  // 3. Member Management & Invitations
  test("Manages team members, invites, role updates, and enforces ownership invariant", async () => {
    const { organization } = await workspaceService.createOrganization(principal, {
      name: "FoxDevStudio Ops",
    });

    // 1. List initial members (creator is owner)
    const initialMembers = await organizationMemberService.listMembers(principal, organization.id);
    expect(initialMembers.length).toBe(1);
    expect(initialMembers[0]?.role).toBe("owner");
    expect(initialMembers[0]?.displayName).toBe("Thiago");

    // 2. Invite teammate
    const invite = await organizationMemberService.inviteMember(principal, organization.id, {
      email: "dan@foxdevstudio.com",
      role: "admin",
    });

    expect(invite.email).toBe("dan@foxdevstudio.com");
    expect(invite.role).toBe("admin");
    expect(invite.inviteUrl).toContain("organization_invite=");

    // 3. List pending invites
    const pending = await organizationMemberService.listPendingInvites(principal, organization.id);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(invite.id);

    // 4. Revoke invite
    await organizationMemberService.revokeInvite(principal, organization.id, invite.id);
    const pendingAfterRevoke = await organizationMemberService.listPendingInvites(principal, organization.id);
    expect(pendingAfterRevoke.length).toBe(0);

    // 5. Invariant: Cannot remove sole owner
    await expect(
      organizationMemberService.removeMember(principal, organization.id, principal.userId)
    ).rejects.toThrow("Cannot remove sole owner of organization");
  });

  // 4. Proton Relay & Bridge Devices
  test("Manages Relay status, Bridge device pairing, and revocation", async () => {
    const { organization } = await workspaceService.createOrganization(principal, {
      name: "FoxDevStudio Central",
    });

    // 1. Relay status
    const status = await relayAndDeviceService.getRelayStatus(principal, organization.id);
    expect(status.status).toBe("offline");

    // 2. List Bridge devices
    const devices = await relayAndDeviceService.listRelayDevices(principal, organization.id);
    expect(devices).toHaveLength(0);

    // 3. Request provisioning for a new laptop device
    const prov = await relayDeviceService.startProvisioning({
      deviceName: "Thiago MacBook Pro",
      platform: "macOS (Apple Silicon)",
      version: "0.1.0",
      protocolVersion: 1,
      capabilities: { protonImap: true, protonSmtp: true, cloudflareTunnel: true },
    });

    expect(prov.deviceCode.startsWith("mwrp_")).toBe(true);

    await relayDeviceService.authorizeProvisioning(principal, organization.id, prov.userCode);
    const paired = await relayDeviceService.pollProvisioning(prov.deviceCode);
    expect(paired.state).toBe("authorized");
    expect(paired.device?.status).toBe("offline");
    expect(paired.credential?.deviceSecret.startsWith("mwrd_")).toBe(true);

    const heartbeat = await relayDeviceService.heartbeat(paired.credential!.deviceSecret, {
      status: "online",
      version: { version: "0.1.0", protocol: 1, platform: "darwin-arm64" },
      deviceId: paired.device!.id,
      organizationId: organization.id,
      components: [],
      accounts: { connected: 1, configured: 1 },
      observedAt: new Date().toISOString(),
    });
    expect(heartbeat.state).toBe("ok");
    expect((await relayAndDeviceService.getRelayStatus(principal, organization.id)).connectedAccountsCount).toBe(1);

    // 5. Revoke device
    await relayAndDeviceService.revokeDevice(principal, organization.id, paired.device!.id);
    const afterRevoke = await relayAndDeviceService.listRelayDevices(principal, organization.id);
    expect(afterRevoke.find((d) => d.id === paired.device!.id)?.revokedAt).toBeDefined();
    expect((await relayDeviceService.heartbeat(paired.credential!.deviceSecret, {
      status: "online",
      version: { version: "0.1.0", protocol: 1, platform: "darwin-arm64" },
      components: [],
      accounts: { connected: 1, configured: 1 },
      observedAt: new Date().toISOString(),
    })).state).toBe("revoked");
  });

  // 5. Human-First Diagnostics & Safe Repair Mapping
  test("Translates raw error codes into friendly human diagnostics with actionable repair steps", () => {
    // 1. Proton Bridge stopped
    const d1 = mapRawErrorToDiagnostic("ECONNREFUSED 127.0.0.1:1143");
    expect(d1.code).toBe("BRIDGE_NOT_RUNNING");
    expect(d1.headline).toContain("Proton Bridge is not running");
    // Mailwarden re-checks Proton rather than claiming it can restart Proton's app.
    expect(d1.suggestedActionId).toBe("recheck_proton");

    // 2. Cloudflare Tunnel error
    const d2 = mapRawErrorToDiagnostic("502 Bad Gateway cloudflared tunnel offline");
    expect(d2.code).toBe("TUNNEL_DISCONNECTED");
    expect(d2.headline).toContain("Cloudflare Tunnel disconnected");
    expect(d2.suggestedActionId).toBe("restart_tunnel");

    // 3. Healthy state
    const d3 = mapRawErrorToDiagnostic(undefined);
    expect(d3.code).toBe("HEALTHY");
    expect(d3.headline).toContain("Everything is running normally");
  });

  // 6. Safe Repair Action Execution
  test("Refuses to repair a device that has never reported a reachable endpoint", async () => {
    const { organization } = await workspaceService.createOrganization(principal, {
      name: "FoxDevStudio Test",
    });

    // No device at all: the caller is told, not given a simulated success.
    await expect(
      relayAndDeviceService.executeSafeRepair(principal, organization.id, "missing-device", "restart_gateway")
    ).rejects.toThrow(/Relay device/i);
  });

  // 7. Plan Capabilities
  test("Applies correct plan capabilities between Personal and Team workspaces", async () => {
    const personalCaps = await planService.getCapabilities(principal, principal.tenantId);
    expect(personalCaps.sharedProtonRelay).toBe(false);
    expect(personalCaps.maxOrganizationSeats).toBe(1);

    const { organization } = await workspaceService.createOrganization(principal, {
      name: "FoxDevStudio Enterprise",
    });
    const teamCaps = await planService.getCapabilities(principal, organization.id);
    expect(teamCaps.sharedProtonRelay).toBe(true);
    expect(teamCaps.maxOrganizationSeats).toBe(10);
    expect(teamCaps.maxRelayDevices).toBe(3);
  });

  // 8. UI Badge Formatter Consistency
  test("UI status formatters return valid labels, dots, and colors", () => {
    const onlineBadge = formatRelayStatusBadge("online");
    expect(onlineBadge.label).toBe("Online");
    expect(onlineBadge.dotColor).toBe("#10b981");

    const degradedBadge = formatRelayStatusBadge("degraded");
    expect(degradedBadge.label).toBe("Degraded");

    const ownerRole = formatMembershipRole("owner");
    expect(ownerRole.label).toBe("Owner");
  });
});
