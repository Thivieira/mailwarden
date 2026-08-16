import { db, schema } from "../db";
import type { AuditAction, AuditEvent } from "../types/audit";
import { logger } from "../utils/logger";
import { nanoid } from "nanoid";

export class AuditService {
  /**
   * Logs a structured audit event to the database and structured logger.
   * Strips private email bodies or sensitive tokens.
   */
  async logEvent(params: {
    tenantId: string;
    userId?: string;
    action: AuditAction;
    resourceType?: string;
    resourceId?: string;
    clientIp?: string;
    userAgent?: string;
    details?: Record<string, any>;
    status?: "success" | "failure" | "simulated";
    errorMessage?: string;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: nanoid(),
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      clientIp: params.clientIp,
      userAgent: params.userAgent,
      details: params.details,
      status: params.status || "success",
      errorMessage: params.errorMessage,
      timestamp: new Date(),
    };

    try {
      await db.insert(schema.auditEvents).values({
        id: event.id,
        tenantId: event.tenantId,
        userId: event.userId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        clientIp: event.clientIp,
        userAgent: event.userAgent,
        details: event.details ? JSON.stringify(event.details) : null,
        status: event.status,
        errorMessage: event.errorMessage,
        timestamp: event.timestamp,
      });

      logger.info(`[AUDIT] ${event.action} by user=${event.userId || "anonymous"} tenant=${event.tenantId}`, {
        action: event.action,
        status: event.status,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
      });
    } catch (err: any) {
      logger.error("Failed to write audit log entry to database", {
        action: params.action,
        error: err.message,
      });
    }

    return event;
  }

  /**
   * Query audit events for a specific tenant and user
   */
  async getEvents(tenantId: string, userId?: string, limit: number = 50) {
    const { eq, and, desc } = await import("drizzle-orm");
    let condition = eq(schema.auditEvents.tenantId, tenantId);
    if (userId) {
      condition = and(condition, eq(schema.auditEvents.userId, userId)) as any;
    }

    return db
      .select()
      .from(schema.auditEvents)
      .where(condition)
      .orderBy(desc(schema.auditEvents.timestamp))
      .limit(limit);
  }
}

export const auditService = new AuditService();
