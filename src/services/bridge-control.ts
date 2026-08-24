/**
 * Cloud → Bridge control plane.
 *
 * The portal's diagnostics and repair actions used to be stubs. They are real
 * here: Cloud looks up the device's own gateway secret, signs a request, and
 * calls that device's gateway through its tunnel. Nothing is simulated — when a
 * relay has no reachable endpoint the caller is told so.
 *
 * Requests are signed rather than bearer-authenticated so a credential that
 * leaked into a log or a proxy trace cannot be replayed into a repair action.
 */
import type { BridgeDiagnosticReport, BridgeRepairAction, BridgeRepairResult, RelayDevice } from "@mailwarden/contracts";
import { signGatewayRequest } from "@mailwarden/relay";
import { validateProtonGatewayUrl } from "@mailwarden/proton";
import type { AuthPrincipal } from "../types/auth";
import { NotFoundError, ProviderError, ValidationError } from "../utils/errors";
import { auditService } from "./audit";
import { organizationService } from "./organizations";
import { relayDeviceService } from "./relay-devices";

const CONTROL_TIMEOUT_MS = 10_000;

export class BridgeControlService {
  /** Resolves the device, its callable endpoint, and its gateway secret. */
  private async target(principal: AuthPrincipal, organizationId: string, deviceId: string, role: "member" | "admin") {
    await organizationService.requireWorkspaceMembership(principal, organizationId, role === "admin" ? "admin" : undefined);
    const devices = await relayDeviceService.listDevices(principal, organizationId);
    const device = devices.find((candidate) => candidate.id === deviceId);
    if (!device) throw new NotFoundError("Relay device", deviceId);
    if (device.revokedAt) throw new ValidationError("This relay device has been revoked");

    const endpoint = device.health?.endpoint;
    if (!endpoint) {
      throw new ValidationError(
        "This relay has not reported a reachable endpoint yet, so Mailwarden cannot run remote diagnostics on it"
      );
    }
    // Same guard the Proton provider uses: HTTPS unless loopback, and never a
    // cloud metadata address.
    validateProtonGatewayUrl(endpoint);
    const gatewaySecret = await relayDeviceService.getGatewaySecret(organizationId, deviceId);
    return { device, endpoint: endpoint.replace(/\/+$/, ""), gatewaySecret };
  }

  private async call<T>(
    target: { endpoint: string; gatewaySecret: string },
    path: string,
    init: { method: "GET" | "POST"; body?: unknown }
  ): Promise<T> {
    const body = init.body === undefined ? "" : JSON.stringify(init.body);
    const timestamp = Math.floor(Date.now() / 1000);
    const url = new URL(`${target.endpoint}${path}`);
    const signature = signGatewayRequest(target.gatewaySecret, {
      method: init.method,
      path: url.pathname,
      timestamp,
      body,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          "X-Mailwarden-Signature": signature,
          "X-Mailwarden-Timestamp": String(timestamp),
        },
        body: init.method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      });
    } catch {
      // Never echo the URL or headers: they identify the relay and carry a signature.
      throw new ProviderError("The Mailwarden Bridge on this relay did not respond", "proton");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("This relay rejected Mailwarden's control request", "proton");
    }
    if (!response.ok) throw new ProviderError("The Mailwarden Bridge on this relay reported an error", "proton");
    return (await response.json()) as T;
  }

  /** Live diagnostics from the device itself. */
  async diagnostics(
    principal: AuthPrincipal,
    organizationId: string,
    deviceId: string
  ): Promise<BridgeDiagnosticReport> {
    const target = await this.target(principal, organizationId, deviceId, "member");
    return this.call<BridgeDiagnosticReport>(target, "/v1/control/diagnostics", { method: "GET" });
  }

  /** Runs one safe repair action on the device. Admin only, and always audited. */
  async repair(
    principal: AuthPrincipal,
    organizationId: string,
    deviceId: string,
    action: BridgeRepairAction
  ): Promise<BridgeRepairResult> {
    const target = await this.target(principal, organizationId, deviceId, "admin");
    const result = await this.call<BridgeRepairResult>(target, "/v1/control/repair", {
      method: "POST",
      body: { action },
    });
    await auditService.logEvent({
      tenantId: organizationId,
      userId: principal.userId,
      action: "RELAY_REPAIR_REQUESTED",
      resourceType: "relay_device",
      resourceId: deviceId,
      details: { repairAction: action, applied: result.applied },
    });
    return result;
  }

  /** Whether Cloud can reach this device at all, for UI that offers the actions. */
  isControllable(device: RelayDevice): boolean {
    return Boolean(device.health?.endpoint) && !device.revokedAt;
  }
}

export const bridgeControlService = new BridgeControlService();
