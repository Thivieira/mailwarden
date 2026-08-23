import { createHash } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getPlanCapabilities, roleAtLeast } from "@mailwarden/organizations";
import type {
  Mailbox,
  MembershipRole,
  OrganizationInvite,
  PlanId,
  Workspace,
  WorkspaceContext,
} from "@mailwarden/contracts";
import { config } from "../config";
import { db, schema } from "../db";
import type { AuthPrincipal } from "../types/auth";
import { AuthorizationError, NotFoundError, ValidationError } from "../utils/errors";
import { auditService } from "./audit";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (value: Date | null | undefined) => value?.toISOString();

function workspace(row: typeof schema.tenants.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    plan: row.plan,
    createdAt: row.createdAt.toISOString(),
  };
}

function invite(row: typeof schema.organizationInvites.$inferSelect): OrganizationInvite {
  return {
    id: row.id,
    organizationId: row.tenantId,
    email: row.email || undefined,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: iso(row.acceptedAt),
    revokedAt: iso(row.revokedAt),
  };
}

function normalizeEmail(value?: string): string | undefined {
  if (!value) return undefined;
  const email = value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError("A valid invitation email is required");
  return email;
}

export class OrganizationService {
  async requireWorkspaceMembership(
    principal: Pick<AuthPrincipal, "userId">,
    workspaceId: string,
    requiredRole: MembershipRole = "member"
  ): Promise<WorkspaceContext> {
    const [row] = await db
      .select({ membership: schema.memberships, workspace: schema.tenants })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(eq(schema.memberships.userId, principal.userId), eq(schema.memberships.tenantId, workspaceId)))
      .limit(1);

    if (!row || row.workspace.status !== "active") {
      throw new AuthorizationError("Authenticated identity is not an active member of this workspace");
    }
    const role = row.membership.role as MembershipRole;
    if (!roleAtLeast(role, requiredRole)) {
      throw new AuthorizationError(`Workspace role '${requiredRole}' is required`);
    }

    return {
      userId: principal.userId,
      workspace: workspace(row.workspace),
      membership: {
        id: row.membership.id,
        workspaceId: row.membership.tenantId,
        userId: row.membership.userId,
        role,
        createdAt: row.membership.createdAt.toISOString(),
      },
    };
  }

  async listWorkspaces(principal: Pick<AuthPrincipal, "userId">): Promise<WorkspaceContext[]> {
    const rows = await db
      .select({ membership: schema.memberships, workspace: schema.tenants })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(eq(schema.memberships.userId, principal.userId));

    return rows
      .filter((row: any) => row.workspace.status === "active")
      .map((row: any) => ({
        userId: principal.userId,
        workspace: workspace(row.workspace),
        membership: {
          id: row.membership.id,
          workspaceId: row.membership.tenantId,
          userId: row.membership.userId,
          role: row.membership.role as MembershipRole,
          createdAt: row.membership.createdAt.toISOString(),
        },
      }));
  }

  async createOrganization(principal: AuthPrincipal, input: { name: string; slug?: string }) {
    const name = String(input.name || "").trim();
    if (name.length < 2) throw new ValidationError("Organization name must be at least 2 characters long");
    if (name.length > 100) throw new ValidationError("Organization name cannot exceed 100 characters");

    const [identity] = await db.select().from(schema.users).where(eq(schema.users.id, principal.userId)).limit(1);
    if (!identity) throw new AuthorizationError("Identity no longer exists");
    const [personal] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, identity.tenantId)).limit(1);
    if (!personal) throw new AuthorizationError("Personal Workspace no longer exists");

    const capabilities = getPlanCapabilities(personal.plan as PlanId);
    if (!capabilities.canCreateOrganization) throw new AuthorizationError("Current plan cannot create Team Organizations");
    const owned = (await this.listWorkspaces(principal)).filter(
      (context) => context.workspace.kind === "team" && context.membership.role === "owner"
    );
    if (owned.length >= capabilities.maxTeamOrganizations) {
      throw new AuthorizationError("Team Organization limit reached for the current plan");
    }

    const baseSlug = String(input.slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "team";
    let slug = baseSlug;
    const [collision] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
    if (collision) slug = `${baseSlug}-${nanoid(6).toLowerCase()}`;

    const id = nanoid();
    const now = new Date();
    await db.insert(schema.tenants).values({ id, name, slug, kind: "team", status: "active", plan: "team", createdAt: now, updatedAt: now });
    try {
      await db.insert(schema.memberships).values({ id: nanoid(), tenantId: id, userId: principal.userId, role: "owner", createdAt: now });
    } catch (error) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
      throw error;
    }

    await auditService.logEvent({
      tenantId: id,
      userId: principal.userId,
      action: "WORKSPACE_CREATED",
      resourceType: "workspace",
      resourceId: id,
      details: { kind: "team", plan: "team" },
    });
    return this.requireWorkspaceMembership(principal, id, "owner");
  }

  async listMembers(principal: AuthPrincipal, workspaceId: string) {
    await this.requireTeamRole(principal, workspaceId, "member");
    return db
      .select({
        id: schema.memberships.id,
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.memberships.role,
        createdAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, workspaceId));
  }

  async createInvite(principal: AuthPrincipal, workspaceId: string, input: { email?: string; role?: string; expiresInDays?: number }) {
    await this.requireTeamRole(principal, workspaceId, "admin");
    const role = (input.role || "member") as "admin" | "member";
    if (role !== "admin" && role !== "member") throw new ValidationError("Invitation role must be admin or member");
    const email = normalizeEmail(input.email);
    const expiresInDays = Math.max(1, Math.min(30, Number(input.expiresInDays || 7)));
    await this.assertSeatAvailable(workspaceId, true);

    const token = `mwoi_${nanoid(40)}`;
    const now = new Date();
    const row = {
      id: nanoid(),
      tenantId: workspaceId,
      tokenHash: hash(token),
      email,
      role,
      createdByUserId: principal.userId,
      expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000),
      createdAt: now,
    } as const;
    await db.insert(schema.organizationInvites).values(row);
    await auditService.logEvent({
      tenantId: workspaceId,
      userId: principal.userId,
      action: "MEMBER_INVITED",
      resourceType: "organization_invite",
      resourceId: row.id,
      details: { role, emailLocked: Boolean(email), expiresInDays },
    });
    return { invite: invite({ ...row, email: row.email ?? null, acceptedByUserId: null, acceptedAt: null, revokedAt: null }), token, inviteUrl: `${config.APP_BASE_URL}/portal/signup?organization_invite=${encodeURIComponent(token)}` };
  }

  async listInvites(principal: AuthPrincipal, workspaceId: string) {
    await this.requireTeamRole(principal, workspaceId, "admin");
    const rows = await db.select().from(schema.organizationInvites).where(eq(schema.organizationInvites.tenantId, workspaceId));
    return rows.map(invite);
  }

  async revokeInvite(principal: AuthPrincipal, workspaceId: string, inviteId: string) {
    await this.requireTeamRole(principal, workspaceId, "admin");
    const [revoked] = await db.update(schema.organizationInvites).set({ revokedAt: new Date() }).where(and(
      eq(schema.organizationInvites.id, inviteId),
      eq(schema.organizationInvites.tenantId, workspaceId),
      isNull(schema.organizationInvites.acceptedAt),
      isNull(schema.organizationInvites.revokedAt)
    )).returning();
    if (!revoked) throw new NotFoundError("Active organization invite", inviteId);
    await auditService.logEvent({ tenantId: workspaceId, userId: principal.userId, action: "INVITE_REVOKED", resourceType: "organization_invite", resourceId: inviteId });
    return invite(revoked);
  }

  async validateInviteForRegistration(token: string, email: string) {
    const row = await this.getUsableInvite(token);
    const normalized = normalizeEmail(email)!;
    if (row.email && row.email !== normalized) throw new AuthorizationError("This organization invitation is locked to another email address");
    return invite(row);
  }

  async acceptInvite(principal: AuthPrincipal, token: string) {
    if (!String(token || "").startsWith("mwoi_")) throw new ValidationError("Invalid organization invitation");
    const tokenHash = hash(String(token || ""));
    let [row] = await db.select().from(schema.organizationInvites).where(eq(schema.organizationInvites.tokenHash, tokenHash)).limit(1);
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new ValidationError("Organization invitation is invalid, revoked, or expired");
    if (row.acceptedAt && row.acceptedByUserId !== principal.userId) throw new ValidationError("Organization invitation was already used");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, principal.userId)).limit(1);
    if (!user) throw new AuthorizationError("Identity no longer exists");
    if (row.email && row.email !== user.email.toLowerCase()) {
      throw new AuthorizationError("This organization invitation is locked to another email address");
    }

    const [existing] = await db.select().from(schema.memberships).where(and(
      eq(schema.memberships.tenantId, row.tenantId), eq(schema.memberships.userId, principal.userId)
    )).limit(1);
    if (!existing) await this.assertSeatAvailable(row.tenantId, false);

    if (!row.acceptedAt) {
      const [claimed] = await db.update(schema.organizationInvites).set({ acceptedAt: new Date(), acceptedByUserId: principal.userId }).where(and(
        eq(schema.organizationInvites.id, row.id),
        eq(schema.organizationInvites.tokenHash, tokenHash),
        isNull(schema.organizationInvites.acceptedAt),
        isNull(schema.organizationInvites.revokedAt),
        gt(schema.organizationInvites.expiresAt, new Date())
      )).returning();
      if (!claimed) {
        const [latest] = await db.select().from(schema.organizationInvites).where(eq(schema.organizationInvites.id, row.id)).limit(1);
        if (!latest || latest.acceptedByUserId !== principal.userId) throw new ValidationError("Organization invitation was already used");
        row = latest;
      } else {
        row = claimed;
      }
    }

    if (!existing) {
      await db.insert(schema.memberships).values({ id: nanoid(), tenantId: row.tenantId, userId: principal.userId, role: row.role, createdAt: new Date() }).onConflictDoNothing();
    } else if (existing.role !== "owner" && roleAtLeast(row.role, existing.role as MembershipRole)) {
      await db.update(schema.memberships).set({ role: row.role }).where(eq(schema.memberships.id, existing.id));
    }

    await auditService.logEvent({ tenantId: row.tenantId, userId: principal.userId, action: "MEMBER_JOINED", resourceType: "organization_invite", resourceId: row.id, details: { role: row.role } });
    return this.requireWorkspaceMembership(principal, row.tenantId);
  }

  async changeMemberRole(principal: AuthPrincipal, workspaceId: string, userId: string, role: MembershipRole) {
    const actor = await this.requireTeamRole(principal, workspaceId, "admin");
    if (!(["owner", "admin", "member"] as string[]).includes(role)) throw new ValidationError("Invalid membership role");
    if (userId === principal.userId) throw new AuthorizationError("Members cannot change their own role");
    const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.tenantId, workspaceId), eq(schema.memberships.userId, userId))).limit(1);
    if (!target) throw new NotFoundError("Organization member", userId);
    if (actor.membership.role !== "owner" && (target.role === "owner" || role === "owner")) {
      throw new AuthorizationError("Only an owner can change organization ownership");
    }
    if (target.role === "owner" && role !== "owner") await this.assertAnotherOwner(workspaceId, userId);
    const [updated] = await db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, target.id)).returning();
    await auditService.logEvent({ tenantId: workspaceId, userId: principal.userId, action: "MEMBER_ROLE_CHANGED", resourceType: "membership", resourceId: target.id, details: { targetUserId: userId, from: target.role, to: role } });
    return updated;
  }

  async removeMember(principal: AuthPrincipal, workspaceId: string, userId: string) {
    const actor = await this.requireTeamRole(principal, workspaceId, "admin");
    const [target] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.tenantId, workspaceId), eq(schema.memberships.userId, userId))).limit(1);
    if (!target) throw new NotFoundError("Organization member", userId);
    if (target.role === "owner") {
      if (actor.membership.role !== "owner") throw new AuthorizationError("Administrators cannot remove an owner");
      await this.assertAnotherOwner(workspaceId, userId);
    }
    await db.delete(schema.memberships).where(eq(schema.memberships.id, target.id));
    await db.delete(schema.sessions).where(and(eq(schema.sessions.tenantId, workspaceId), eq(schema.sessions.userId, userId)));
    await db.update(schema.oauthTokens).set({ revokedAt: new Date() }).where(and(eq(schema.oauthTokens.tenantId, workspaceId), eq(schema.oauthTokens.userId, userId)));
    await auditService.logEvent({ tenantId: workspaceId, userId: principal.userId, action: "MEMBER_REMOVED", resourceType: "membership", resourceId: target.id, details: { targetUserId: userId } });
    return { removed: true };
  }

  async listMailboxes(principal: AuthPrincipal, workspaceId: string): Promise<Mailbox[]> {
    await this.requireWorkspaceMembership(principal, workspaceId);
    const rows = await db.select().from(schema.emailAccounts).where(eq(schema.emailAccounts.tenantId, workspaceId));
    return rows.map((row: any) => ({
      id: row.id,
      workspaceId: row.tenantId,
      userId: row.userId,
      provider: row.provider,
      emailAddress: row.emailAddress,
      status: row.status,
    }));
  }

  async requireMailboxCapacity(principal: Pick<AuthPrincipal, "userId">, workspaceId: string): Promise<void> {
    const context = await this.requireWorkspaceMembership(principal, workspaceId);
    const capabilities = getPlanCapabilities(context.workspace.plan);
    const mailboxes = await db.select({ id: schema.emailAccounts.id }).from(schema.emailAccounts).where(
      eq(schema.emailAccounts.tenantId, workspaceId)
    );
    if (mailboxes.length >= capabilities.maxMailboxes) throw new AuthorizationError("Workspace mailbox limit reached");
  }

  private async requireTeamRole(principal: AuthPrincipal, workspaceId: string, role: MembershipRole) {
    const context = await this.requireWorkspaceMembership(principal, workspaceId, role);
    if (context.workspace.kind !== "team") throw new ValidationError("Operation requires a Team Organization");
    return context;
  }

  private async getUsableInvite(token: string) {
    if (!String(token || "").startsWith("mwoi_")) throw new ValidationError("Invalid organization invitation");
    const [row] = await db.select().from(schema.organizationInvites).where(eq(schema.organizationInvites.tokenHash, hash(token))).limit(1);
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new ValidationError("Organization invitation is invalid, revoked, or expired");
    if (row.acceptedAt) throw new ValidationError("Organization invitation was already used");
    return row;
  }

  private async assertSeatAvailable(workspaceId: string, includePending: boolean) {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, workspaceId)).limit(1);
    if (!tenant) throw new NotFoundError("Workspace", workspaceId);
    const capabilities = getPlanCapabilities(tenant.plan as PlanId);
    const members = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.tenantId, workspaceId));
    let used = members.length;
    if (includePending) {
      const now = new Date();
      const pending = await db.select({ id: schema.organizationInvites.id }).from(schema.organizationInvites).where(and(
        eq(schema.organizationInvites.tenantId, workspaceId), isNull(schema.organizationInvites.acceptedAt), isNull(schema.organizationInvites.revokedAt), gt(schema.organizationInvites.expiresAt, now)
      ));
      used += pending.length;
    }
    if (used >= capabilities.maxOrganizationSeats) throw new AuthorizationError("Organization seat limit reached");
  }

  private async assertAnotherOwner(workspaceId: string, excludedUserId: string) {
    const owners = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(
      eq(schema.memberships.tenantId, workspaceId), eq(schema.memberships.role, "owner")
    ));
    if (!owners.some((owner: any) => owner.userId !== excludedUserId)) {
      throw new AuthorizationError("Cannot remove sole owner of organization");
    }
  }
}

export const organizationService = new OrganizationService();
