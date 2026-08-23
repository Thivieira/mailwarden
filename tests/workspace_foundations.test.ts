import { describe, expect, test } from "bun:test";
import { requireWorkspaceMembership, hasWorkspaceRole } from "@mailwarden/organizations";
import { isRelayHeartbeatFresh } from "@mailwarden/relay";
import { validateProtonGatewayUrl } from "@mailwarden/proton";
import type { WorkspaceContext } from "@mailwarden/contracts";

const context: WorkspaceContext = {
  userId: "user-1",
  workspace: {
    id: "workspace-1",
    name: "Personal",
    slug: "personal-1",
    kind: "personal",
    status: "active",
    plan: "personal",
    createdAt: "2026-08-23T00:00:00.000Z",
  },
  membership: {
    id: "membership-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    role: "owner",
    createdAt: "2026-08-23T00:00:00.000Z",
  },
};

describe("shared workspace foundations", () => {
  test("rejects workspace spoofing and preserves the role hierarchy", () => {
    expect(requireWorkspaceMembership(context, "workspace-1")).toBe(context);
    expect(() => requireWorkspaceMembership(context, "workspace-2")).toThrow();
    expect(hasWorkspaceRole(context, "admin")).toBe(true);
  });

  test("validates relay freshness and Proton gateway transport", () => {
    const now = Date.parse("2026-08-23T12:00:00Z");
    expect(isRelayHeartbeatFresh({ observedAt: "2026-08-23T11:59:00Z" }, now)).toBe(true);
    expect(isRelayHeartbeatFresh({ observedAt: "2026-08-23T11:00:00Z" }, now)).toBe(false);
    expect(validateProtonGatewayUrl("https://relay.example.com/v1").hostname).toBe("relay.example.com");
    expect(() => validateProtonGatewayUrl("http://relay.example.com/v1")).toThrow();
  });
});
