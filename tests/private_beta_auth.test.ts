import { describe, expect, it } from "bun:test";
import { nanoid } from "nanoid";
import { updateConfig } from "../src/config";
import { authService } from "../src/services/auth";
import { userAuthService } from "../src/services/user-auth";

updateConfig({ BETA_ADMIN_SECRET: "test-beta-admin-secret-that-is-long-enough" });

describe("Private beta multi-user authentication", () => {
  it("provisions independent private vaults for different users", async () => {
    const suffix = nanoid();
    const alice = await userAuthService.provisionPrivateBetaUser({
      email: `alice-${suffix}@example.com`,
      displayName: "Alice",
    });
    const bob = await userAuthService.provisionPrivateBetaUser({
      email: `bob-${suffix}@example.com`,
      displayName: "Bob",
    });

    expect(alice.tenantId).not.toBe(bob.tenantId);
    expect(alice.userId).not.toBe(bob.userId);
    expect(alice.loginSecret.startsWith("mw_")).toBe(true);
    expect(bob.loginSecret.startsWith("mw_")).toBe(true);

    const aliceUser = await userAuthService.authenticateUser(alice.email, alice.loginSecret);
    const bobUser = await userAuthService.authenticateUser(bob.email, bob.loginSecret);
    expect(aliceUser.tenantId).toBe(alice.tenantId);
    expect(bobUser.tenantId).toBe(bob.tenantId);
  });

  it("rejects incorrect login secrets", async () => {
    const suffix = nanoid();
    const user = await userAuthService.provisionPrivateBetaUser({
      email: `wrong-secret-${suffix}@example.com`,
      displayName: "Wrong Secret Test",
    });

    await expect(userAuthService.authenticateUser(user.email, "this-is-definitely-not-the-right-secret")).rejects.toThrow();
  });

  it("rotating a beta secret invalidates the previous secret", async () => {
    const suffix = nanoid();
    const user = await userAuthService.provisionPrivateBetaUser({
      email: `rotate-${suffix}@example.com`,
      displayName: "Rotate Test",
    });
    const oldSecret = user.loginSecret;
    const rotated = await userAuthService.rotatePrivateBetaSecret(user.email);

    expect(rotated.loginSecret).not.toBe(oldSecret);
    await expect(userAuthService.authenticateUser(user.email, oldSecret)).rejects.toThrow();
    const authenticated = await userAuthService.authenticateUser(user.email, rotated.loginSecret);
    expect(authenticated.id).toBe(user.userId);
  });

  it("issues tokens bound to the authenticated user's own vault", async () => {
    const suffix = nanoid();
    const user = await userAuthService.provisionPrivateBetaUser({
      email: `token-${suffix}@example.com`,
      displayName: "Token Test",
    });
    const storedUser = await userAuthService.authenticateUser(user.email, user.loginSecret);
    const { token } = await authService.createToken({
      id: storedUser.id,
      tenantId: storedUser.tenantId,
      email: storedUser.email,
      displayName: storedUser.displayName,
      role: storedUser.role,
    }, undefined, "1h");

    const principal = await authService.verifyToken(token);
    expect(principal.userId).toBe(user.userId);
    expect(principal.tenantId).toBe(user.tenantId);
  });
});
