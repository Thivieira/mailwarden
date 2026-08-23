/**
 * Moved to Bridge Core.
 *
 * The Proton Gateway now lives in `apps/bridge/src/core/gateway.ts` with device
 * authentication, rate/size limits, and honest health. This shim keeps the old
 * Cloud-side import path and `bun run proton:gateway` working during integration.
 */
export { startProtonGateway } from "../../apps/bridge/src/gateway";
export { createGatewayApp, startGateway } from "../../apps/bridge/src/core/gateway";
