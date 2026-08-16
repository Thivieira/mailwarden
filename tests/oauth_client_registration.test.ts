import { describe, expect, it } from "bun:test";
import { nanoid } from "nanoid";
import { updateConfig, config } from "../src/config";
import { oauthService } from "../src/services/oauth";

/**
 * /oauth/authorize can register a client without any authentication, so the guards on
 * that path are the only thing standing between an unknown caller and a row in
 * oauth_clients carrying every scope.
 */
describe("OAuth client self-registration guards", () => {
  const CHATGPT_CALLBACK = "https://chatgpt.com/aip/plugin-oauth/callback";

  it("rejects an unknown client_id even on a permitted callback host", async () => {
    await expect(
      oauthService.validateClient(`unknown-${nanoid(8)}`, CHATGPT_CALLBACK)
    ).rejects.toThrow(/Unknown OAuth client_id/);
  });

  // Once the compat client exists in the table the registered-client branch rejects
  // first, so either refusal is correct; what matters is that neither is registered.
  const REFUSED = /Unknown OAuth client_id|Invalid redirect_uri/;

  it("rejects the known compat client on an unexpected path of the same host", async () => {
    await expect(
      oauthService.validateClient("chatgpt_mcp_client", "https://chatgpt.com/anything-else")
    ).rejects.toThrow(REFUSED);
  });

  it("rejects a lookalike host", async () => {
    await expect(
      oauthService.validateClient("chatgpt_mcp_client", "https://chatgpt.com.evil.test/aip/plugin-oauth/callback")
    ).rejects.toThrow(REFUSED);
  });

  it("accepts the known compat client on its exact callback", async () => {
    const client = await oauthService.validateClient("chatgpt_mcp_client", CHATGPT_CALLBACK);
    expect(client.clientId).toBe("chatgpt_mcp_client");
    expect(client.redirectUris).toContain(CHATGPT_CALLBACK);
  });

  it("rejects loopback callbacks while ALLOW_DEV_AUTH is off", async () => {
    updateConfig({ ALLOW_DEV_AUTH: "false" } as any);
    expect(config.ALLOW_DEV_AUTH).toBe(false);
    await expect(
      oauthService.validateClient(`local-${nanoid(8)}`, "http://localhost:5173/callback")
    ).rejects.toThrow(/Unknown OAuth client_id/);
  });

  it("accepts loopback callbacks when ALLOW_DEV_AUTH is on, then locks back down", async () => {
    updateConfig({ ALLOW_DEV_AUTH: "true" } as any);
    const devId = `local-${nanoid(8)}`;
    const client = await oauthService.validateClient(devId, "http://127.0.0.1:5173/callback");
    expect(client.clientId).toBe(devId);
    expect(client.clientName).toBe("Local Development Client");

    updateConfig({ ALLOW_DEV_AUTH: "false" } as any);
    await expect(
      oauthService.validateClient(`local-${nanoid(8)}`, "http://127.0.0.1:5173/callback")
    ).rejects.toThrow(/Unknown OAuth client_id/);
  });

  it("reports a malformed redirect_uri instead of throwing a raw TypeError", async () => {
    await expect(
      oauthService.validateClient(`unknown-${nanoid(8)}`, "not-a-url")
    ).rejects.toThrow(/Invalid redirect_uri/);
  });

  it("still enforces the registered redirect_uri for an already-known client", async () => {
    const redirectUri = `https://claude.ai/cb/${nanoid(6)}`;
    const { clientId } = await oauthService.registerClient({
      clientName: "Registered client",
      redirectUris: [redirectUri],
      isPublic: true,
    });

    await expect(
      oauthService.validateClient(clientId, "https://claude.ai/somewhere-else")
    ).rejects.toThrow(/Invalid redirect_uri/);
  });
});
