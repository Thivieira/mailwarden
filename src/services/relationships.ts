import { db, schema } from "../db";
import { eq, and, sql } from "drizzle-orm";
import type { AuthPrincipal } from "../types/auth";
import type {
  SenderProfile,
  RelationshipProfile,
  RelationshipType,
} from "../types/intelligence";
import { authService } from "./auth";
import { auditService } from "./audit";
import { nanoid } from "nanoid";

export class RelationshipService {
  /**
   * Finds or creates a sender profile for a given email address within the user's tenant
   */
  async getOrCreateSenderProfile(
    principal: AuthPrincipal,
    emailAddress: string,
    displayName?: string
  ): Promise<SenderProfile> {
    authService.requirePrincipal(principal);
    const normalizedEmail = emailAddress.toLowerCase().trim();
    const domain = normalizedEmail.split("@")[1] || "unknown";

    const [existing] = await db
      .select()
      .from(schema.senderProfiles)
      .where(
        and(
          eq(schema.senderProfiles.tenantId, principal.tenantId),
          eq(schema.senderProfiles.userId, principal.userId),
          eq(schema.senderProfiles.email, normalizedEmail)
        )
      )
      .limit(1);

    if (existing) {
      return {
        ...existing,
        displayName: existing.displayName || undefined,
        notes: existing.notes || undefined,
        historicalImportance: existing.historicalImportance / 100,
        usuallyRequiresReply: Boolean(existing.usuallyRequiresReply),
      };
    }

    const now = new Date();
    const newId = nanoid();

    await db.insert(schema.senderProfiles).values({
      id: newId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      email: normalizedEmail,
      domain,
      displayName: displayName || null,
      messagesSeen: 1,
      repliesFromUser: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      historicalImportance: 50,
      usuallyRequiresReply: false,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(schema.senderProfiles)
      .where(eq(schema.senderProfiles.id, newId))
      .limit(1);

    return {
      ...created!,
      displayName: created!.displayName || undefined,
      notes: created!.notes || undefined,
      historicalImportance: created!.historicalImportance / 100,
      usuallyRequiresReply: Boolean(created!.usuallyRequiresReply),
    };
  }

  /**
   * Records a seen message from a sender, updating count and lastSeen timestamp
   */
  async recordMessageReceived(
    principal: AuthPrincipal,
    emailAddress: string,
    displayName?: string
  ): Promise<void> {
    const profile = await this.getOrCreateSenderProfile(principal, emailAddress, displayName);
    const now = new Date();

    await db
      .update(schema.senderProfiles)
      .set({
        messagesSeen: profile.messagesSeen + 1,
        displayName: displayName || profile.displayName || null,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.senderProfiles.id, profile.id),
          eq(schema.senderProfiles.tenantId, principal.tenantId)
        )
      );
  }

  /**
   * Records that the user replied to a sender
   */
  async recordUserReply(principal: AuthPrincipal, recipientEmail: string): Promise<void> {
    const profile = await this.getOrCreateSenderProfile(principal, recipientEmail);
    const now = new Date();

    const newReplyCount = profile.repliesFromUser + 1;
    // Heuristic: if user replies frequently, usuallyRequiresReply becomes true
    const usuallyRequiresReply = newReplyCount >= 2;

    await db
      .update(schema.senderProfiles)
      .set({
        repliesFromUser: newReplyCount,
        usuallyRequiresReply,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.senderProfiles.id, profile.id),
          eq(schema.senderProfiles.tenantId, principal.tenantId)
        )
      );
  }

  /**
   * Retrieves full relationship profile and sender profile for an email
   */
  async getRelationshipContext(
    principal: AuthPrincipal,
    emailAddress: string
  ): Promise<{
    senderProfile: SenderProfile;
    relationship?: RelationshipProfile;
    organization?: { id: string; name: string; domain?: string };
    projects: Array<{ id: string; name: string; status: string }>;
  }> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "relationships.read");

    const senderProfile = await this.getOrCreateSenderProfile(principal, emailAddress);

    const [rel] = await db
      .select()
      .from(schema.relationships)
      .where(
        and(
          eq(schema.relationships.tenantId, principal.tenantId),
          eq(schema.relationships.userId, principal.userId),
          eq(schema.relationships.senderProfileId, senderProfile.id)
        )
      )
      .limit(1);

    let organization: { id: string; name: string; domain?: string } | undefined = undefined;
    if (rel?.organizationId) {
      const [org] = await db
        .select()
        .from(schema.organizations)
        .where(
          and(
            eq(schema.organizations.id, rel.organizationId),
            eq(schema.organizations.tenantId, principal.tenantId)
          )
        )
        .limit(1);
      if (org) {
        organization = {
          id: org.id,
          name: org.name,
          domain: org.domain || undefined,
        };
      }
    }

    const projectsList: Array<{ id: string; name: string; status: string }> = [];
    if (rel?.activeProjectIds && rel.activeProjectIds.length > 0) {
      for (const pId of rel.activeProjectIds) {
        const [proj] = await db
          .select()
          .from(schema.projects)
          .where(
            and(
              eq(schema.projects.id, pId),
              eq(schema.projects.tenantId, principal.tenantId)
            )
          )
          .limit(1);
        if (proj) projectsList.push(proj);
      }
    }

    const relationshipProfile: RelationshipProfile | undefined = rel
      ? {
          id: rel.id,
          tenantId: rel.tenantId,
          userId: rel.userId,
          senderProfileId: rel.senderProfileId,
          type: rel.type as RelationshipType,
          organizationId: rel.organizationId || undefined,
          activeProjectIds: rel.activeProjectIds,
          importanceOverride: rel.importanceOverride !== null && rel.importanceOverride !== undefined ? rel.importanceOverride / 100 : undefined,
          userDefined: Boolean(rel.userDefined),
          notes: rel.notes || undefined,
          createdAt: rel.createdAt,
          updatedAt: rel.updatedAt,
        }
      : undefined;

    return {
      senderProfile,
      relationship: relationshipProfile,
      organization,
      projects: projectsList,
    };
  }

  /**
   * Explicit user correction for sender relationship (e.g. "This person is a client")
   */
  async setSenderRelationship(
    principal: AuthPrincipal,
    params: {
      emailAddress: string;
      type: RelationshipType;
      organizationName?: string;
      notes?: string;
    }
  ): Promise<RelationshipProfile> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "relationships.manage");

    const senderProfile = await this.getOrCreateSenderProfile(principal, params.emailAddress);
    const now = new Date();

    let organizationId: string | undefined = undefined;
    if (params.organizationName) {
      organizationId = await this.getOrCreateOrganization(principal, params.organizationName);
    }

    const [existing] = await db
      .select()
      .from(schema.relationships)
      .where(
        and(
          eq(schema.relationships.tenantId, principal.tenantId),
          eq(schema.relationships.userId, principal.userId),
          eq(schema.relationships.senderProfileId, senderProfile.id)
        )
      )
      .limit(1);

    let resultId: string;
    if (existing) {
      resultId = existing.id;
      await db
        .update(schema.relationships)
        .set({
          type: params.type,
          organizationId: organizationId || existing.organizationId,
          notes: params.notes || existing.notes,
          userDefined: true,
          updatedAt: now,
        })
        .where(eq(schema.relationships.id, existing.id));
    } else {
      resultId = nanoid();
      await db.insert(schema.relationships).values({
        id: resultId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        senderProfileId: senderProfile.id,
        type: params.type,
        organizationId: organizationId || null,
        activeProjectIds: [],
        importanceOverride: params.type === "client" ? 90 : params.type === "recruiter" ? 80 : 60,
        userDefined: true,
        notes: params.notes || null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await auditService.logEvent({
      tenantId: principal.tenantId,
      userId: principal.userId,
      action: "RELATIONSHIP_UPDATE",
      resourceType: "relationship",
      resourceId: resultId,
      details: { email: params.emailAddress, type: params.type, userDefined: true },
    });

    const [updated] = await db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.id, resultId))
      .limit(1);

    return {
      id: updated!.id,
      tenantId: updated!.tenantId,
      userId: updated!.userId,
      senderProfileId: updated!.senderProfileId,
      type: updated!.type as RelationshipType,
      organizationId: updated!.organizationId || undefined,
      activeProjectIds: updated!.activeProjectIds,
      importanceOverride: updated!.importanceOverride ? updated!.importanceOverride / 100 : undefined,
      userDefined: Boolean(updated!.userDefined),
      notes: updated!.notes || undefined,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  }

  /**
   * Associates a sender with an active project
   */
  async associateSenderWithProject(
    principal: AuthPrincipal,
    emailAddress: string,
    projectName: string
  ): Promise<void> {
    authService.requirePrincipal(principal);
    authService.requireScope(principal, "relationships.manage");

    const senderProfile = await this.getOrCreateSenderProfile(principal, emailAddress);
    const projectId = await this.getOrCreateProject(principal, projectName);

    const [rel] = await db
      .select()
      .from(schema.relationships)
      .where(
        and(
          eq(schema.relationships.tenantId, principal.tenantId),
          eq(schema.relationships.userId, principal.userId),
          eq(schema.relationships.senderProfileId, senderProfile.id)
        )
      )
      .limit(1);

    const now = new Date();
    if (rel) {
      const projects = Array.from(new Set([...rel.activeProjectIds, projectId]));
      await db
        .update(schema.relationships)
        .set({ activeProjectIds: projects, updatedAt: now })
        .where(eq(schema.relationships.id, rel.id));
    } else {
      await db.insert(schema.relationships).values({
        id: nanoid(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        senderProfileId: senderProfile.id,
        type: "unknown",
        activeProjectIds: [projectId],
        userDefined: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async getOrCreateOrganization(principal: AuthPrincipal, name: string): Promise<string> {
    const [existing] = await db
      .select()
      .from(schema.organizations)
      .where(
        and(
          eq(schema.organizations.tenantId, principal.tenantId),
          eq(schema.organizations.userId, principal.userId),
          eq(schema.organizations.name, name.trim())
        )
      )
      .limit(1);

    if (existing) return existing.id;

    const id = nanoid();
    const now = new Date();
    await db.insert(schema.organizations).values({
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async getOrCreateProject(principal: AuthPrincipal, name: string): Promise<string> {
    const [existing] = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.tenantId, principal.tenantId),
          eq(schema.projects.userId, principal.userId),
          eq(schema.projects.name, name.trim())
        )
      )
      .limit(1);

    if (existing) return existing.id;

    const id = nanoid();
    const now = new Date();
    await db.insert(schema.projects).values({
      id,
      tenantId: principal.tenantId,
      userId: principal.userId,
      name: name.trim(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }
}

export const relationshipService = new RelationshipService();
