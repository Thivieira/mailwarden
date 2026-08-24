import type { AuthPrincipal } from "../types/auth";
import type { StoredDraft, SendResult } from "../types/drafts";
import type { ConnectionTestResult } from "@mailwarden/contracts";
import { ProviderError, ConfigurationError } from "../utils/errors";
import { config } from "../config";
import { logger } from "../utils/logger";
import nodemailer from "nodemailer";

export interface SmtpTransportSettings {
  host: string;
  port: number;
  secure?: boolean;
  username: string;
  password?: string;
  rejectUnauthorized?: boolean;
}

export interface SmtpTransportLike {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
  verify?(): Promise<unknown>;
}

function formatAddressList(
  list?: Array<{ name?: string; address: string }>
): string | undefined {
  if (!list || list.length === 0) return undefined;
  return list
    .filter((entry) => entry?.address)
    .map((entry) => (entry.name ? `"${entry.name.replace(/"/g, "")}" <${entry.address}>` : entry.address))
    .join(", ");
}

export class SmtpProvider {
  private settings: SmtpTransportSettings;
  private transportFactory?: (settings: SmtpTransportSettings) => SmtpTransportLike;

  constructor(
    settings: SmtpTransportSettings,
    transportFactory?: (settings: SmtpTransportSettings) => SmtpTransportLike
  ) {
    if (!settings.host || !settings.port) {
      throw new ConfigurationError("SMTP host and port are required");
    }
    this.settings = settings;
    this.transportFactory = transportFactory;
  }

  private createTransporter(): SmtpTransportLike {
    if (this.transportFactory) {
      return this.transportFactory(this.settings);
    }

    const { host, port, username, password, secure, rejectUnauthorized } = this.settings;
    const isExplicitSecure = secure !== undefined ? secure : port === 465;

    return nodemailer.createTransport({
      host,
      port,
      secure: isExplicitSecure,
      auth: username ? { user: username, pass: password || "" } : undefined,
      tls: {
        rejectUnauthorized: rejectUnauthorized ?? true,
        servername: host,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    }) as unknown as SmtpTransportLike;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const transporter = this.createTransporter();
      if (typeof transporter.verify === "function") {
        await transporter.verify();
      }
      return {
        ok: true,
        code: "success",
        humanMessage: `Successfully connected to SMTP server ${this.settings.host}:${this.settings.port}.`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      const msg = err.message || String(err);
      const code = err.code || "";
      const latencyMs = Date.now() - startedAt;

      if (
        code === "EAUTH" ||
        msg.includes("Invalid login") ||
        msg.includes("authentication failed") ||
        msg.includes("535")
      ) {
        return {
          ok: false,
          code: "auth_rejected",
          humanMessage: "SMTP authentication rejected. Check your username and password, or use an App Password.",
          technicalDetail: msg,
          latencyMs,
        };
      }

      if (
        code === "ENOTFOUND" ||
        code === "ECONNREFUSED" ||
        code === "EHOSTUNREACH" ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ENOTFOUND")
      ) {
        return {
          ok: false,
          code: "server_unreachable",
          humanMessage: `Could not reach SMTP server '${this.settings.host}' on port ${this.settings.port}.`,
          technicalDetail: msg,
          latencyMs,
        };
      }

      if (code === "ETIMEDOUT" || msg.includes("Timeout") || msg.includes("timed out")) {
        return {
          ok: false,
          code: "timeout",
          humanMessage: `Connection to SMTP server '${this.settings.host}' timed out.`,
          technicalDetail: msg,
          latencyMs,
        };
      }

      return {
        ok: false,
        code: "unknown_error",
        humanMessage: `SMTP connection failed: ${msg}`,
        technicalDetail: msg,
        latencyMs,
      };
    }
  }

  async sendDraft(
    _principal: AuthPrincipal,
    _accountId: string,
    draft: StoredDraft
  ): Promise<SendResult> {
    const to = formatAddressList(draft.to);
    if (!to) {
      throw new ProviderError("At least one recipient is required to send an email", "smtp");
    }

    // Safety Invariant: MAILBOX_MUTATIONS_ENABLED=false prevents real outbound mail
    if (!config.MAILBOX_MUTATIONS_ENABLED) {
      logger.info("[DRY RUN] SMTP sending simulated: message was not dispatched to network", {
        to: draft.to.map((t) => t.address),
        subject: draft.subject,
      });

      return {
        success: true,
        providerMessageId: `smtp_simulated_${Date.now()}`,
        draftId: draft.id,
        sentAt: new Date(),
        simulated: true,
      };
    }

    try {
      const transporter = this.createTransporter();
      const info = await transporter.sendMail({
        from: this.settings.username,
        to,
        cc: formatAddressList(draft.cc),
        bcc: formatAddressList(draft.bcc),
        subject: draft.subject,
        text: draft.textBody,
        html: draft.htmlBody || undefined,
        inReplyTo: draft.replyToMessageId || undefined,
      });

      logger.info("Message sent via authenticated SMTP", {
        host: this.settings.host,
        messageId: info.messageId,
      });

      return {
        success: true,
        providerMessageId: info.messageId || `smtp_sent_${Date.now()}`,
        draftId: draft.id,
        sentAt: new Date(),
        simulated: false,
      };
    } catch (err: any) {
      throw new ProviderError(`SMTP dispatch failed: ${err.message}`, "smtp", true, err);
    }
  }
}
