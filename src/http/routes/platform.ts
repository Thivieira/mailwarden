import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { authService } from "../../services/auth";
import { organizationService } from "../../services/organizations";
import { relayDeviceService } from "../../services/relay-devices";
import { AuthenticationError, ValidationError } from "../../utils/errors";
import { readBody, withPrincipal, type Env } from "../context";

const organizationInput = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(64).optional() });
const inviteInput = z.object({ email: z.string().trim().email().optional(), role: z.enum(["admin", "member"]).default("member"), expiresInDays: z.coerce.number().int().min(1).max(30).default(7) });
const roleInput = z.object({ role: z.enum(["owner", "admin", "member"]) });
const acceptInviteInput = z.object({ token: z.string().startsWith("mwoi_") });
const provisioningStartInput = z.object({
  deviceName: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(50),
  protocolVersion: z.number().int().positive().max(100).optional(),
  capabilities: z.object({ protonImap: z.boolean(), protonSmtp: z.boolean(), cloudflareTunnel: z.boolean() }),
  organizationId: z.string().optional(),
});
const authorizeProvisioningInput = z.object({ organizationId: z.string().min(1), userCode: z.string().min(6).max(16) });
const pollProvisioningInput = z.object({ deviceCode: z.string().startsWith("mwrp_") });
const heartbeatInput = z.object({
  status: z.enum(["provisioning", "online", "degraded", "offline", "needs_attention"]),
  version: z.object({ version: z.string(), protocol: z.number().int().positive(), platform: z.string() }),
  deviceId: z.string().optional(),
  organizationId: z.string().optional(),
  components: z.array(z.object({
    component: z.enum(["cloud", "tunnel", "gateway", "protonBridge", "accounts", "deviceIdentity"]),
    status: z.enum(["ok", "degraded", "down", "unknown", "needs_attention"]),
    detail: z.string().max(500),
    checkedAt: z.string().datetime(),
  })).max(20),
  accounts: z.object({ connected: z.number().int().nonnegative(), configured: z.number().int().nonnegative() }),
  observedAt: z.string().datetime(),
  /** Where Cloud may call this device back for diagnostics and repair. */
  endpoint: z.string().url().max(500).optional(),
});
const bridgeHeartbeatInput = z.object({
  heartbeat: z.object({
    deviceId: z.string(),
    observedAt: z.string().datetime(),
    status: z.enum(["provisioning", "online", "degraded", "offline", "needs_attention"]),
    gatewayReachable: z.boolean(),
    protonBridgeReachable: z.boolean(),
    tunnelConnected: z.boolean(),
    connectedAccountCount: z.number().int().nonnegative(),
  }),
  health: heartbeatInput,
  generation: z.number().int().positive(),
});
const deviceCredentialInput = z.object({ deviceId: z.string().min(1), generation: z.number().int().positive() });
const deviceIdentityInput = z.object({ deviceId: z.string().min(1) });

async function parsed<T extends z.ZodType>(c: any, validator: T): Promise<z.infer<T>> {
  const result = validator.safeParse(await readBody(c));
  if (!result.success) throw new ValidationError("Invalid request", result.error.flatten());
  return result.data;
}

function principal(c: any) {
  const value = c.get("principal");
  if (!value) throw new AuthenticationError("Bearer token required");
  return value;
}

function bearer(c: any): string {
  const header = c.req.header("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new AuthenticationError("Device credential required");
  return header.slice(7).trim();
}

function requireBridgeV1(c: any): void {
  if (c.req.header("x-mailwarden-bridge-protocol") !== "1") {
    throw new ValidationError("Unsupported Mailwarden Bridge protocol version");
  }
}

export const platformRoutes = new Hono<Env>()
  .use("/api/*", withPrincipal)

  /**
   * The switcher needs a workspace plus the caller's role in it — not the whole
   * authorization context. Returning contexts here shipped a shape no client
   * expected: `kind` sat one level down, so every consumer read `undefined`.
   */
  .get("/api/workspaces", async (c) => {
    const contexts = await organizationService.listWorkspaces(principal(c));
    return c.json({
      workspaces: contexts.map((context) => ({ ...context.workspace, role: context.membership.role })),
    });
  })

  .get("/api/workspaces/current", async (c) => {
    const current = principal(c);
    return c.json(await organizationService.requireWorkspaceMembership(current, current.tenantId));
  })

  .post("/api/workspaces/:workspaceId/select", async (c) => {
    const current = principal(c);
    const context = await organizationService.requireWorkspaceMembership(current, c.req.param("workspaceId"));
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, current.userId)).limit(1);
    if (!user) throw new AuthenticationError("Identity no longer exists");
    const token = await authService.createToken({
      id: user.id,
      tenantId: context.workspace.id,
      email: user.email,
      displayName: user.displayName,
      role: context.membership.role,
    });
    c.header("Set-Cookie", `mw_token=${encodeURIComponent(token.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return c.json({ context, token: token.token, expiresAt: token.expiresAt.toISOString() });
  })

  .post("/api/organizations", async (c) => c.json(
    await organizationService.createOrganization(principal(c), await parsed(c, organizationInput)),
    201
  ))

  .get("/api/organizations/:workspaceId/members", async (c) => c.json({ members: await organizationService.listMembers(principal(c), c.req.param("workspaceId")) }))
  .get("/api/organizations/:workspaceId/invites", async (c) => c.json({ invites: await organizationService.listInvites(principal(c), c.req.param("workspaceId")) }))
  .post("/api/organizations/:workspaceId/invites", async (c) => c.json(
    await organizationService.createInvite(principal(c), c.req.param("workspaceId"), await parsed(c, inviteInput)),
    201
  ))
  .delete("/api/organizations/:workspaceId/invites/:inviteId", async (c) => c.json(
    await organizationService.revokeInvite(principal(c), c.req.param("workspaceId"), c.req.param("inviteId"))
  ))
  .post("/api/organization-invites/accept", async (c) => {
    const input = await parsed(c, acceptInviteInput);
    return c.json(await organizationService.acceptInvite(principal(c), input.token));
  })
  .patch("/api/organizations/:workspaceId/members/:userId", async (c) => {
    const input = await parsed(c, roleInput);
    return c.json(await organizationService.changeMemberRole(principal(c), c.req.param("workspaceId"), c.req.param("userId"), input.role));
  })
  .delete("/api/organizations/:workspaceId/members/:userId", async (c) => c.json(
    await organizationService.removeMember(principal(c), c.req.param("workspaceId"), c.req.param("userId"))
  ))
  .get("/api/workspaces/:workspaceId/mailboxes", async (c) => c.json({ mailboxes: await organizationService.listMailboxes(principal(c), c.req.param("workspaceId")) }))

  /**
   * Human approval of a device's short code. This is the one relay endpoint a
   * person calls; devices use the versioned `/api/bridge/v1/*` protocol below.
   */
  .post("/api/relay/provisioning/authorize", async (c) => {
    const input = await parsed(c, authorizeProvisioningInput);
    return c.json(await relayDeviceService.authorizeProvisioning(principal(c), input.organizationId, input.userCode));
  })

  .post("/api/bridge/v1/provisioning/start", async (c) => {
    requireBridgeV1(c);
    return c.json(await relayDeviceService.startProvisioning(await parsed(c, provisioningStartInput)), 201);
  })
  .post("/api/bridge/v1/provisioning/poll", async (c) => {
    requireBridgeV1(c);
    const input = await parsed(c, pollProvisioningInput);
    return c.json(await relayDeviceService.pollProvisioning(input.deviceCode));
  })
  .post("/api/bridge/v1/devices/heartbeat", async (c) => {
    requireBridgeV1(c);
    const input = await parsed(c, bridgeHeartbeatInput);
    return c.json(await relayDeviceService.heartbeat(bearer(c), input.health));
  })
  .post("/api/bridge/v1/devices/credential/renew", async (c) => {
    requireBridgeV1(c);
    const input = await parsed(c, deviceCredentialInput);
    return c.json(await relayDeviceService.renewDeviceCredential(bearer(c), input.deviceId, input.generation));
  })
  .post("/api/bridge/v1/devices/tunnel", async (c) => {
    requireBridgeV1(c);
    const input = await parsed(c, deviceIdentityInput);
    await relayDeviceService.getTunnelCredential(bearer(c), input.deviceId);
    return c.json({ error: "NotFound", message: "No managed tunnel is provisioned for this relay device" }, 404);
  })
  .get("/api/organizations/:workspaceId/relay-devices", async (c) => c.json({ devices: await relayDeviceService.listDevices(principal(c), c.req.param("workspaceId")) }))
  .delete("/api/organizations/:workspaceId/relay-devices/:deviceId", async (c) => c.json(
    await relayDeviceService.revokeDevice(principal(c), c.req.param("workspaceId"), c.req.param("deviceId"))
  ))
  .post("/api/organizations/:workspaceId/relay-devices/:deviceId/rotate-credential", async (c) => c.json(
    await relayDeviceService.rotateCredential(principal(c), c.req.param("workspaceId"), c.req.param("deviceId"))
  ));
