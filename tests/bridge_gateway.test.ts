import { describe, test, expect } from "bun:test";
import { createGatewayApp, tlsOptionsFor, type ImapClientLike, type SmtpTransportLike } from "../apps/bridge/src/core/gateway";
import {
  NonceCache,
  RateLimiter,
  readCallContext,
  signGatewayRequest,
  verifyGatewayRequest,
} from "@mailwarden/relay";

const DEVICE_SECRET = "device-gateway-secret-value";
const LEGACY_KEY = "legacy-deployment-key";
const BRIDGE_PASSWORD = "sup3r-secret-bridge-password";

const RAW_MESSAGE = [
  "From: Alice <alice@example.com>",
  "To: Relay <relay@proton.me>",
  "Subject: Quarterly numbers",
  "Message-ID: <msg-1@example.com>",
  "Date: Mon, 17 Aug 2026 10:00:00 +0000",
  "",
  "The numbers are attached.",
].join("\r\n");

function fakeMessage(uid: number) {
  return {
    uid,
    source: Buffer.from(RAW_MESSAGE),
    flags: new Set<string>(),
    internalDate: new Date("2026-08-17T10:00:00Z"),
  };
}

const imapCredentials: Array<{ user: string; pass: string }> = [];

class FakeImapClient implements ImapClientLike {
  moved: string[] = [];
  flagsAdded: string[][] = [];

  constructor(settings: { user: string; pass: string }) {
    imapCredentials.push({ user: settings.user, pass: settings.pass });
  }
  async connect() {}
  async logout() {}
  async mailboxOpen() {
    return { exists: 2 };
  }
  async *fetch() {
    yield fakeMessage(1);
    yield fakeMessage(2);
  }
  async fetchOne(range: string) {
    return range === "1" ? fakeMessage(1) : null;
  }
  async messageFlagsAdd(_range: string, flags: string[]) {
    this.flagsAdded.push(flags);
  }
  async messageFlagsRemove() {}
  async messageMove(_range: string, target: string) {
    this.moved.push(target);
  }
}

const sentMessages: Array<Record<string, unknown>> = [];

class FakeSmtp implements SmtpTransportLike {
  async sendMail(message: Record<string, unknown>) {
    sentMessages.push(message);
    return { messageId: "<sent-1@proton.me>" };
  }
}

function makeApp(overrides: Partial<Parameters<typeof createGatewayApp>[0]> = {}, logs: unknown[][] = []) {
  return createGatewayApp({
    port: 0,
    proton: { imapHost: "127.0.0.1", imapPort: 1143, smtpHost: "127.0.0.1", smtpPort: 1025 },
    secrets: () => ({ deviceSecret: DEVICE_SECRET, legacySharedKey: LEGACY_KEY }),
    imapClientFactory: (settings) => new FakeImapClient(settings),
    smtpTransportFactory: () => new FakeSmtp(),
    probe: async () => true,
    logger: (level, message, fields) => logs.push([level, message, fields]),
    ...overrides,
  });
}

const context = {
  "X-Tenant-Id": "tenant_1",
  "X-User-Id": "user_1",
  "X-Account-Id": "account_1",
  "X-Proton-Username": "relay@proton.me",
  "X-Proton-Password": BRIDGE_PASSWORD,
};

describe("gateway authentication", () => {
  test("rejects a request with no credential", async () => {
    const response = await makeApp().request("/v1/search", { method: "POST", headers: context });
    expect(response.status).toBe(401);
  });

  test("rejects a wrong bearer token", async () => {
    const response = await makeApp().request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: "Bearer not-the-secret-value-x" },
    });
    expect(response.status).toBe(401);
  });

  test("accepts the per-device gateway secret", async () => {
    const response = await makeApp().request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 10 }),
    });
    expect(response.status).toBe(200);
  });

  test("accepts the legacy shared key but warns about it", async () => {
    const logs: unknown[][] = [];
    const response = await makeApp({}, logs).request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${LEGACY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    expect(logs.some(([, message]) => String(message).includes("legacy key"))).toBe(true);
  });

  test("accepts a signed request and rejects the same signature twice", () => {
    const nonces = new NonceCache();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ query: "invoice" });
    const signature = signGatewayRequest(DEVICE_SECRET, {
      method: "POST",
      path: "/v1/search",
      timestamp,
      body,
    });
    const headers = new Headers({
      "x-mailwarden-signature": signature,
      "x-mailwarden-timestamp": String(timestamp),
    });
    const request = { method: "POST", path: "/v1/search", headers, rawBody: body };

    expect(verifyGatewayRequest(request, { deviceSecret: DEVICE_SECRET }, nonces)).toEqual({
      ok: true,
      mode: "device-signature",
    });
    expect(verifyGatewayRequest(request, { deviceSecret: DEVICE_SECRET }, nonces)).toEqual({
      ok: false,
      reason: "replayed_signature",
    });
  });

  test("rejects a signature outside the timestamp window", () => {
    const timestamp = Math.floor(Date.now() / 1000) - 3600;
    const body = "";
    const signature = signGatewayRequest(DEVICE_SECRET, { method: "GET", path: "/v1/health", timestamp, body });
    const result = verifyGatewayRequest(
      {
        method: "GET",
        path: "/v1/health",
        headers: new Headers({ "x-mailwarden-signature": signature, "x-mailwarden-timestamp": String(timestamp) }),
        rawBody: body,
      },
      { deviceSecret: DEVICE_SECRET },
      new NonceCache()
    );
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  test("rejects a signature computed over a different body", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signGatewayRequest(DEVICE_SECRET, {
      method: "POST",
      path: "/v1/send",
      timestamp,
      body: JSON.stringify({ to: [{ address: "alice@example.com" }] }),
    });
    const result = verifyGatewayRequest(
      {
        method: "POST",
        path: "/v1/send",
        headers: new Headers({ "x-mailwarden-signature": signature, "x-mailwarden-timestamp": String(timestamp) }),
        rawBody: JSON.stringify({ to: [{ address: "attacker@example.com" }] }),
      },
      { deviceSecret: DEVICE_SECRET },
      new NonceCache()
    );
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("gateway request validation", () => {
  test("requires caller context headers", async () => {
    const response = await makeApp().request("/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
  });

  test("rejects malformed tenant identifiers", () => {
    expect(() =>
      readCallContext(
        new Headers({ "x-tenant-id": "tenant 1; DROP", "x-user-id": "user_1", "x-account-id": "account_1" })
      )
    ).toThrow(/Malformed X-Tenant-Id/);
  });

  test("rejects an oversized body", async () => {
    const app = makeApp({ maxRequestBytes: 64 });
    const response = await app.request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(500) }),
    });
    expect(response.status).toBe(413);
  });

  test("rate limits once the per-minute budget is spent", async () => {
    const app = makeApp({ requestsPerMinute: 2 });
    const send = () =>
      app.request("/v1/search", {
        method: "POST",
        headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
        body: "{}",
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  test("rejects a non-numeric message UID", async () => {
    const response = await makeApp().request("/v1/messages/not-a-uid", {
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}` },
    });
    expect(response.status).toBe(400);
  });
});

describe("gateway behaviour", () => {
  test("selects the Proton account from the request headers", async () => {
    imapCredentials.length = 0;
    await makeApp().request("/v1/search", {
      method: "POST",
      headers: {
        ...context,
        "X-Proton-Username": "second@proton.me",
        Authorization: `Bearer ${DEVICE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(imapCredentials.at(-1)?.user).toBe("second@proton.me");
  });

  test("normalizes and filters search results", async () => {
    const response = await makeApp().request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "quarterly" }),
    });
    const body = (await response.json()) as { messages: any[] };
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].subject).toBe("Quarterly numbers");
    expect(body.messages[0].from.address).toBe("alice@example.com");
    expect(body.messages[0].tenantId).toBe("tenant_1");
  });

  test("a query that matches nothing returns nothing", async () => {
    const response = await makeApp().request("/v1/search", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "zzz-not-present" }),
    });
    expect(((await response.json()) as { messages: any[] }).messages).toEqual([]);
  });

  test("reports unhealthy when Proton Bridge IMAP is unreachable", async () => {
    const response = await makeApp({ probe: async () => false }).request("/v1/health", {
      headers: { Authorization: `Bearer ${DEVICE_SECRET}` },
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { status: string }).status).toBe("unhealthy");
  });

  test("send requires a recipient", async () => {
    const response = await makeApp().request("/v1/send", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "no recipient" }),
    });
    expect(response.status).toBe(400);
  });

  test("send formats recipients and never logs the Bridge password", async () => {
    const logs: unknown[][] = [];
    const response = await makeApp({}, logs).request("/v1/send", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [{ name: "Alice", address: "alice@example.com" }],
        subject: "Hello",
        textBody: "Body",
      }),
    });
    expect(response.status).toBe(200);
    expect(sentMessages.at(-1)?.to).toBe('"Alice" <alice@example.com>');
    expect(JSON.stringify(logs)).not.toContain(BRIDGE_PASSWORD);
  });

  test("archive moves the message", async () => {
    let client: FakeImapClient | null = null;
    const app = makeApp({
      imapClientFactory: (settings) => {
        client = new FakeImapClient(settings);
        return client;
      },
    });
    const response = await app.request("/v1/messages/1/mutate", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    expect(response.status).toBe(200);
    expect(client!.moved).toEqual(["Archive"]);
  });

  test("refuses an unsupported mutation", async () => {
    const response = await makeApp().request("/v1/messages/1/mutate", {
      method: "POST",
      headers: { ...context, Authorization: `Bearer ${DEVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_forever" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("rate limiter", () => {
  test("resets on the next minute window", () => {
    const limiter = new RateLimiter(1);
    const start = 60_000;
    expect(limiter.allow(start)).toBe(true);
    expect(limiter.allow(start + 100)).toBe(false);
    expect(limiter.allow(start + 60_000)).toBe(true);
  });
});

describe("proton bridge TLS", () => {
  test("supplies a non-IP servername so STARTTLS can negotiate", () => {
    expect(tlsOptionsFor("127.0.0.1")).toEqual({ rejectUnauthorized: false, servername: "localhost" });
  });

  test("refuses to skip certificate verification for a non-loopback host", () => {
    expect(() => tlsOptionsFor("bridge.internal.example")).toThrow(/must be loopback/);
  });
});
