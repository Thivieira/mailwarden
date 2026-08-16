import { describe, expect, it } from "bun:test";
import { oauthService } from "../src/services/oauth";
import { app } from "../src/http/app";

describe("GET /oauth/authorize HTML response", () => {
  it("returns unserialized HTML with browser-safe headers and OAuth hidden fields", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/callback-test";
    const { clientId } = await oauthService.registerClient({
      clientName: "ChatGPT HTML render test",
      redirectUris: [redirectUri],
      isPublic: true,
    });

    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: "pkce-challenge-value-for-html-test",
      code_challenge_method: "S256",
      state: "oauth-state-html-test",
      scope: "mail.read mail.search",
      resource: "https://mailwarden.corenet.workers.dev",
    });

    const response = await app.handle(new Request(`http://localhost:3000/oauth/authorize?${query}`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type") || "").toContain("text/html");
    expect(response.headers.get("Cache-Control") || "").toContain("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true);
    expect(html.startsWith('"')).toBe(false);
    expect(html).toMatch(/<form method="post" action="\/oauth\/authorize"/i);
    expect(html).toContain(`name="client_id" value="${clientId}"`);
    expect(html).toContain(`name="redirect_uri" value="${redirectUri}"`);
    expect(html).toContain('name="code_challenge" value="pkce-challenge-value-for-html-test"');
    expect(html).toContain('name="code_challenge_method" value="S256"');
    expect(html).toContain('name="state" value="oauth-state-html-test"');
    expect(html).toContain('name="scope" value="mail.read mail.search"');
    expect(html).toContain('name="resource" value="https://mailwarden.corenet.workers.dev"');
    expect(html).toContain('name="login_secret" type="password"');
    expect(html).not.toMatch(/name="login_secret"[^>]*value="/);
    expect(html).not.toContain("mw_sec_");
    expect(html).not.toContain("client_secret");
    expect(html.toLowerCase()).not.toContain("owner_login_secret");
  });

  it("returns HTML for invalid credential posts", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/callback-denied";
    const { clientId } = await oauthService.registerClient({
      clientName: "ChatGPT HTML deny test",
      redirectUris: [redirectUri],
      isPublic: true,
    });

    const body = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
      email: "nobody@example.com",
      login_secret: "not-a-real-secret",
    });

    const response = await app.handle(
      new Request("http://localhost:3000/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type") || "").toContain("text/html");
    expect(response.headers.get("Cache-Control") || "").toContain("no-store");
    expect(html).toContain("Authorization denied");
    expect(html).not.toContain("not-a-real-secret");
  });
});
