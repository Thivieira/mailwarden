/**
 * Local API for the desktop shell and the CLI.
 *
 * Trust model: loopback only, plus a bearer token written to a 0600 file that
 * only the Bridge user can read. That makes it same-user access, which is the
 * same boundary the secret store already relies on. The `Origin` check exists
 * because a browser on the machine could otherwise be tricked into calling this
 * API through DNS rebinding; a native desktop shell sends no `Origin` at all.
 */
import { Hono } from "hono";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { BridgeRepairAction } from "@mailwarden/contracts";
import type { BridgeCore } from "./bridge";
import type { ProvisioningPrompt } from "./identity";

export type SetupState =
  | { state: "idle" }
  | { state: "pending"; prompt: ProvisioningPrompt }
  | { state: "authorized"; deviceId: string; organizationId: string }
  | { state: "failed"; error: string };

const REPAIR_ACTIONS: BridgeRepairAction[] = [
  "restart_gateway",
  "restart_tunnel",
  "refresh_registration",
  "recheck_proton",
  "fix_permissions",
];

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function issueLocalApiToken(tokenFile: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
  await Bun.write(tokenFile, token);
  await chmod(tokenFile, 0o600);
  return token;
}

export async function readLocalApiToken(tokenFile: string): Promise<string | null> {
  const file = Bun.file(tokenFile);
  if (!(await file.exists())) return null;
  const token = (await file.text()).trim();
  return token.length > 0 ? token : null;
}

export function createLocalApi(core: BridgeCore, token: string) {
  let setup: SetupState = { state: "idle" };

  return new Hono()
    .basePath("/v1")
    .use("*", async (c, next) => {
      const origin = c.req.header("origin");
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return c.json({ error: "Forbidden origin" }, 403);
      }
      const authorization = c.req.header("authorization") || "";
      const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!bearer || !sameToken(bearer, token)) return c.json({ error: "Unauthorized" }, 401);
      return next();
    })
    .get("/status", async (c) => {
      const identity = await core.identity.load();
      const revoked = identity ? null : await core.identity.revocation();
      return c.json({
        version: core.version(),
        deviceName: core.config.deviceName,
        registered: Boolean(identity),
        revoked: Boolean(revoked),
        deviceId: identity?.credential.deviceId ?? revoked?.deviceId,
        organizationId: identity?.credential.organizationId ?? revoked?.organizationId,
        tunnelHostname: core.config.tunnel.hostname,
        health: await core.health(),
      });
    })
    .get("/health", async (c) => c.json(await core.health()))
    .get("/diagnostics", async (c) => c.json(await core.diagnostics()))
    .get("/accounts", (c) => c.json({ accounts: core.accounts.list(), summary: core.accounts.summary() }))
    .post("/repair", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { action?: string };
      const action = REPAIR_ACTIONS.find((candidate) => candidate === body.action);
      if (!action) return c.json({ error: "Unknown repair action" }, 400);
      return c.json(await core.repair(action));
    })
    .get("/setup", (c) => c.json(setup))
    .post("/setup", async (c) => {
      if (setup.state === "pending") return c.json(setup);
      const body = (await c.req.json().catch(() => ({}))) as { organizationId?: string };
      setup = { state: "idle" };
      // Provisioning waits on a human in a browser, so it runs in the background
      // and the shell polls `GET /setup` for the code and the outcome.
      void core
        .setup({
          organizationId: body.organizationId,
          onPrompt: (prompt) => {
            setup = { state: "pending", prompt };
          },
        })
        .then((identity) => {
          setup = {
            state: "authorized",
            deviceId: identity.credential.deviceId,
            organizationId: identity.credential.organizationId,
          };
        })
        .catch((error: unknown) => {
          setup = { state: "failed", error: error instanceof Error ? error.message : "Setup failed" };
        });
      return c.json({ state: "starting" }, 202);
    });
}

export interface RunningLocalApi {
  port: number;
  token: string;
  stop(): Promise<void>;
}

export async function startLocalApi(core: BridgeCore): Promise<RunningLocalApi> {
  const token = await issueLocalApiToken(core.paths.localApiTokenFile);
  const app = createLocalApi(core, token);
  const server = Bun.serve({ port: core.config.localApi.port, hostname: "127.0.0.1", fetch: app.fetch });
  return {
    port: server.port ?? core.config.localApi.port,
    token,
    async stop() {
      await server.stop(true);
    },
  };
}
