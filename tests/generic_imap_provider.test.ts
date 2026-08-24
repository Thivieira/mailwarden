import { describe, it, expect } from "bun:test";
import {
  ImapProvider,
  classifyImapFolder,
  parseAndNormalizeRawEmail,
  type ImapClientLike,
} from "../src/providers/imap";
import type { AuthPrincipal } from "../src/types/auth";

const testPrincipal: AuthPrincipal = {
  tenantId: "ws_test_tenant",
  userId: "usr_test_alice",
  role: "member",
  scopes: ["mail.read", "mail.modify"],
};

describe("Generic IMAP Provider", () => {
  it("exposes complete provider capabilities matching IMAP semantics", () => {
    const provider = new ImapProvider({
      emailAddress: "alice@company.com",
      imap: { host: "imap.company.com", port: 993, username: "alice@company.com" },
      smtp: { host: "smtp.company.com", port: 587, username: "alice@company.com" },
    });

    const caps = provider.getCapabilities();
    expect(caps.read).toBe(true);
    expect(caps.search).toBe(true);
    expect(caps.folders).toBe(true);
    expect(caps.labels).toBe(false); // IMAP uses folders, not Gmail-style labels
    expect(caps.send).toBe(true);
    expect(caps.incrementalSync).toBe(true);
    expect(caps.flags).toBe(true);
  });

  it("correctly classifies standard and localized IMAP folder names", () => {
    expect(classifyImapFolder("INBOX", "\\Inbox")).toBe("inbox");
    expect(classifyImapFolder("Sent Messages", "\\Sent")).toBe("sent");
    expect(classifyImapFolder("Itens Enviados")).toBe("sent");
    expect(classifyImapFolder("Drafts", "\\Drafts")).toBe("drafts");
    expect(classifyImapFolder("Rascunhos")).toBe("drafts");
    expect(classifyImapFolder("Trash", "\\Trash")).toBe("trash");
    expect(classifyImapFolder("Lixeira")).toBe("trash");
    expect(classifyImapFolder("Spam", "\\Junk")).toBe("spam");
    expect(classifyImapFolder("Lixo Eletrônico")).toBe("spam");
    expect(classifyImapFolder("Archive", "\\Archive")).toBe("archive");
    expect(classifyImapFolder("Arquivo")).toBe("archive");
    expect(classifyImapFolder("Projects/Alpha")).toBe("custom");
  });

  it("parses raw RFC 822 MIME message into NormalizedEmail cleanly", async () => {
    const rawMime = `From: "Bob Smith" <bob@example.com>
To: "Alice Doe" <alice@company.com>
Cc: "Charlie" <charlie@partner.com>
Subject: Project Proposal & Contract
Date: Mon, 24 Aug 2026 12:00:00 +0000
Message-ID: <msg-12345@example.com>
In-Reply-To: <parent-999@company.com>
Content-Type: text/plain; charset="utf-8"

Hi Alice,

Attached is the updated contract for review.

Best,
Bob`;

    const normalized = await parseAndNormalizeRawEmail(
      rawMime,
      101,
      { tenantId: "ws_1", userId: "usr_1", accountId: "acc_1" },
      ["\\Seen", "\\Flagged"]
    );

    expect(normalized.provider).toBe("imap");
    expect(normalized.providerMessageId).toBe("101");
    expect(normalized.providerThreadId).toBe("<parent-999@company.com>");
    expect(normalized.from.address).toBe("bob@example.com");
    expect(normalized.from.name).toBe("Bob Smith");
    expect(normalized.to[0]?.address).toBe("alice@company.com");
    expect(normalized.cc[0]?.address).toBe("charlie@partner.com");
    expect(normalized.subject).toBe("Project Proposal & Contract");
    expect(normalized.textBody).toContain("Attached is the updated contract");
    expect(normalized.flags.unread).toBe(false);
    expect(normalized.flags.starred).toBe(true);
  });

  it("handles testConnection diagnostics for success and various failure modes", async () => {
    // 1. Success case
    const mockSuccessClient: ImapClientLike = {
      connect: async () => {},
      logout: async () => {},
      mailboxOpen: async () => ({ exists: 42, uidValidity: 1001n, uidNext: 43 }),
      list: async () => [{ path: "INBOX", name: "INBOX" }, { path: "Sent", name: "Sent" }],
      fetch: async function* () {},
      fetchOne: async () => null,
      messageFlagsAdd: async () => {},
      messageFlagsRemove: async () => {},
      messageMove: async () => {},
    };

    const successProvider = new ImapProvider(
      {
        emailAddress: "alice@company.com",
        imap: { host: "imap.company.com", port: 993, username: "alice@company.com" },
      },
      () => mockSuccessClient
    );

    const successResult = await successProvider.testConnection(testPrincipal, "acc_1");
    expect(successResult.ok).toBe(true);
    expect(successResult.code).toBe("success");
    expect(successResult.humanMessage).toContain("42 messages");
    expect(successResult.foldersFound).toContain("INBOX");

    // 2. Authentication failure case
    const mockAuthFailClient: ImapClientLike = {
      connect: async () => {
        const err: any = new Error("NO [AUTHENTICATIONFAILED] Invalid credentials");
        err.authenticationFailed = true;
        throw err;
      },
      logout: async () => {},
      mailboxOpen: async () => ({}),
      list: async () => [],
      fetch: async function* () {},
      fetchOne: async () => null,
      messageFlagsAdd: async () => {},
      messageFlagsRemove: async () => {},
      messageMove: async () => {},
    };

    const authFailProvider = new ImapProvider(
      {
        emailAddress: "alice@company.com",
        imap: { host: "imap.company.com", port: 993, username: "alice@company.com" },
      },
      () => mockAuthFailClient
    );

    const authFailResult = await authFailProvider.testConnection(testPrincipal, "acc_1");
    expect(authFailResult.ok).toBe(false);
    expect(authFailResult.code).toBe("auth_rejected");
    expect(authFailResult.humanMessage).toContain("rejected by the server");

    // 3. Unreachable host case
    const mockUnreachableClient: ImapClientLike = {
      connect: async () => {
        const err: any = new Error("getaddrinfo ENOTFOUND imap.invalid-host.com");
        err.code = "ENOTFOUND";
        throw err;
      },
      logout: async () => {},
      mailboxOpen: async () => ({}),
      list: async () => [],
      fetch: async function* () {},
      fetchOne: async () => null,
      messageFlagsAdd: async () => {},
      messageFlagsRemove: async () => {},
      messageMove: async () => {},
    };

    const unreachableProvider = new ImapProvider(
      {
        emailAddress: "alice@company.com",
        imap: { host: "imap.invalid-host.com", port: 993, username: "alice@company.com" },
      },
      () => mockUnreachableClient
    );

    const unreachableResult = await unreachableProvider.testConnection(testPrincipal, "acc_1");
    expect(unreachableResult.ok).toBe(false);
    expect(unreachableResult.code).toBe("server_unreachable");
    expect(unreachableResult.humanMessage).toContain("could not reach mail server");
  });

  it("lists folders with correct structure and normalization", async () => {
    const mockClient: ImapClientLike = {
      connect: async () => {},
      logout: async () => {},
      mailboxOpen: async () => ({ exists: 1 }),
      list: async () => [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "Sent Items", name: "Sent Items", specialUse: "\\Sent" },
        { path: "Spam", name: "Spam", specialUse: "\\Junk" },
        { path: "Archive", name: "Archive", specialUse: "\\Archive" },
      ],
      fetch: async function* () {},
      fetchOne: async () => null,
      messageFlagsAdd: async () => {},
      messageFlagsRemove: async () => {},
      messageMove: async () => {},
    };

    const provider = new ImapProvider(
      {
        emailAddress: "alice@company.com",
        imap: { host: "imap.company.com", port: 993, username: "alice@company.com" },
      },
      () => mockClient
    );

    const folders = await provider.listFolders(testPrincipal, "acc_1");
    expect(folders.length).toBe(4);
    expect(folders[0]?.kind).toBe("inbox");
    expect(folders[1]?.kind).toBe("sent");
    expect(folders[2]?.kind).toBe("spam");
    expect(folders[3]?.kind).toBe("archive");
  });

  it("performs incremental message search and UID fetch", async () => {
    const rawMime = `From: boss@corp.com\nTo: alice@company.com\nSubject: Quarterly Review\n\nMeeting at 2pm.`;

    const mockClient: ImapClientLike = {
      connect: async () => {},
      logout: async () => {},
      mailboxOpen: async () => ({ exists: 10, uidValidity: 50n }),
      list: async () => [],
      fetch: async function* () {
        yield {
          uid: 10,
          source: Buffer.from(rawMime),
          flags: new Set(["\\Seen"]),
          internalDate: new Date(),
        };
      },
      fetchOne: async () => null,
      messageFlagsAdd: async () => {},
      messageFlagsRemove: async () => {},
      messageMove: async () => {},
    };

    const provider = new ImapProvider(
      {
        emailAddress: "alice@company.com",
        imap: { host: "imap.company.com", port: 993, username: "alice@company.com" },
      },
      () => mockClient
    );

    const result = await provider.search(testPrincipal, "acc_1", { limit: 10 });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]?.subject).toBe("Quarterly Review");
    expect(result.messages[0]?.from.address).toBe("boss@corp.com");
  });

  it("delegates to Mailwarden Bridge Gateway when configured in gateway mode", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers | undefined;
    let capturedPath = "";

    globalThis.fetch = (async (input: string | URL | any, init?: any) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      capturedPath = url.pathname;
      capturedHeaders = new Headers(init?.headers as any);

      if (url.pathname.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "healthy", protocol: 1 }), { status: 200 });
      }

      if (url.pathname.includes("/search")) {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "msg_gw_1",
                externalId: "123",
                provider: "imap",
                accountId: "acc_gw_1",
                from: { address: "client@enterprise.com" },
                to: [{ address: "alice@company.com" }],
                subject: "Enterprise Contract",
                snippet: "Attached is the signed document.",
                receivedAt: new Date().toISOString(),
                folder: "INBOX",
              },
            ],
            totalEstimated: 1,
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    try {
      const provider = new ImapProvider({
        emailAddress: "alice@company.com",
        mode: "gateway",
        gatewayUrl: "http://127.0.0.1:8080/v1",
        deviceGatewaySecret: "sec_device_test_12345",
        relayDeviceId: "dev_relay_test",
        imap: { host: "mail.internal.lan", port: 993, username: "alice@company.com" },
      });

      const testConn = await provider.testConnection();
      expect(testConn.ok).toBe(true);
      expect(testConn.humanMessage).toContain("Mailwarden Bridge Relay");

      const searchRes = await provider.search(testPrincipal, "acc_gw_1", { limit: 5 });
      expect(searchRes.messages.length).toBe(1);
      expect(searchRes.messages[0]?.subject).toBe("Enterprise Contract");
      expect(capturedPath).toBe("/v1/search");
      expect(capturedHeaders?.get("X-Mailwarden-Signature")).toBeDefined();
      expect(capturedHeaders?.get("X-Mailwarden-Timestamp")).toBeDefined();
      expect(capturedHeaders?.get("X-Tenant-Id")).toBe("ws_test_tenant");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
