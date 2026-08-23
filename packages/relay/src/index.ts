import type { RelayHeartbeat } from "@mailwarden/contracts";

export function isRelayHeartbeatFresh(
  heartbeat: Pick<RelayHeartbeat, "observedAt">,
  now = Date.now(),
  staleAfterMs = 5 * 60 * 1000
): boolean {
  const observedAt = Date.parse(heartbeat.observedAt);
  return Number.isFinite(observedAt) && observedAt <= now && now - observedAt <= staleAfterMs;
}

export * from "./observation";

export * from "./gateway-auth";
