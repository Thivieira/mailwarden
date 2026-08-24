import { describe, it, expect } from "bun:test";
import { SmtpProvider, type SmtpTransportLike } from "../src/providers/smtp";
import type { StoredDraft } from "../src/types/drafts";
import type { AuthPrincipal } from "../src/types/auth";
import { config } from "../src/config";

const testPrincipal: AuthPrincipal = {
  tenantId: "ws_test_tenant",
  userId: "usr_test_alice",
  role: "member",
  scopes: ["mail.read", "mail.draft", "mail.send"],
};

const sampleDraft: StoredDraft = {
  id: "draft_123",
  tenantId: "ws_test_tenant",
  userId: "usr_test_alice",
  accountId: "acc_123",
  identityId: "ident_123",
  to: [{ name: "Bob", address: "bob@example.com" }],
  cc: [{ address: "cc@example.com" }],
  bcc: [],
  subject: "Test Proposal",
  textBody: "Hello Bob,\n\nPlease see proposal.",
  attachments: [],
  status: "draft",
  revision: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("SMTP Transport Provider", () => {
  it("rejects configuration without host or port", () => {
    expect(() => new SmtpProvider({ host: "", port: 587, username: "user" })).toThrow();
  });

  it("verifies connection successfully with mock transporter", async () => {
    const mockTransporter: SmtpTransportLike = {
      sendMail: async () => ({ messageId: "<msg-1@smtp>" }),
      verify: async () => true,
    };

    const provider = new SmtpProvider(
      { host: "smtp.example.com", port: 587, username: "user@example.com", password: "password" },
      () => mockTransporter
    );

    const result = await provider.testConnection();
    expect(result.ok).toBe(true);
    expect(result.code).toBe("success");
    expect(result.humanMessage).toContain("smtp.example.com:587");
  });

  it("reports descriptive diagnostic on SMTP authentication rejection", async () => {
    const mockTransporter: SmtpTransportLike = {
      sendMail: async () => ({}),
      verify: async () => {
        const err: any = new Error("535 5.7.8 Error: authentication failed");
        err.code = "EAUTH";
        throw err;
      },
    };

    const provider = new SmtpProvider(
      { host: "smtp.example.com", port: 587, username: "user@example.com", password: "bad_password" },
      () => mockTransporter
    );

    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("auth_rejected");
    expect(result.humanMessage).toContain("authentication rejected");
  });

  it("strictly enforces MAILBOX_MUTATIONS_ENABLED=false simulation safety invariant", async () => {
    let networkSent = false;
    const mockTransporter: SmtpTransportLike = {
      sendMail: async () => {
        networkSent = true;
        return { messageId: "<sent-msg@network>" };
      },
    };

    const provider = new SmtpProvider(
      { host: "smtp.example.com", port: 587, username: "user@example.com", password: "password" },
      () => mockTransporter
    );

    // Ensure MAILBOX_MUTATIONS_ENABLED is false (Mailwarden safety standard)
    expect(config.MAILBOX_MUTATIONS_ENABLED).toBe(false);

    const sendResult = await provider.sendDraft(testPrincipal, "acc_123", sampleDraft);

    expect(sendResult.success).toBe(true);
    expect(sendResult.simulated).toBe(true);
    expect(networkSent).toBe(false); // Crucial invariant: zero real network dispatch when mutations disabled
    expect(sendResult.providerMessageId).toContain("smtp_simulated_");
  });
});
