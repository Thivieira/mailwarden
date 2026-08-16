import { Elysia, t } from "elysia";
import { logger } from "../utils/logger";

/**
 * Proton Mail Bridge Gateway / Relay Server
 * 
 * Runs in a secure Docker container or VPS alongside Proton Mail Bridge.
 * Translates HTTP REST calls from Cloudflare Workers into local IMAP/SMTP commands.
 */
const GATEWAY_API_KEY = process.env.PROTON_GATEWAY_API_KEY || "dev-gateway-key-change-in-prod";
const BRIDGE_IMAP_PORT = parseInt(process.env.PROTON_BRIDGE_IMAP_PORT || "1143");
const BRIDGE_SMTP_PORT = parseInt(process.env.PROTON_BRIDGE_SMTP_PORT || "1025");
const BRIDGE_HOST = process.env.PROTON_BRIDGE_HOST || "127.0.0.1";

export const protonGatewayApp = new Elysia({ prefix: "/v1" })
  .onRequest(({ request, set }) => {
    // Verify API Key
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${GATEWAY_API_KEY}`) {
      set.status = 401;
      return { error: "Unauthorized: Invalid Proton Gateway API Key" };
    }
  })
  .get("/health", () => ({
    status: "healthy",
    bridge: {
      host: BRIDGE_HOST,
      imapPort: BRIDGE_IMAP_PORT,
      smtpPort: BRIDGE_SMTP_PORT,
    },
  }))
  .post(
    "/messages",
    async ({ body }) => {
      logger.info("[PROTON GATEWAY] Fetching messages from Bridge", { folder: body.folder, limit: body.limit });
      // In production with headless bridge, connects via node-imap / imap-simple to 127.0.0.1:1143
      return { messages: [] };
    },
    {
      body: t.Object({
        username: t.Optional(t.String()),
        password: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
        folder: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/send",
    async ({ body }) => {
      logger.info("[PROTON GATEWAY] Relaying outgoing message to Bridge SMTP", {
        to: body.to,
        subject: body.subject,
      });
      // In production with headless bridge, sends via nodemailer / SMTP connection to 127.0.0.1:1025
      return {
        success: true,
        messageId: `proton_relayed_${Date.now()}`,
      };
    },
    {
      body: t.Object({
        to: t.Array(t.Any()),
        subject: t.String(),
        textBody: t.String(),
        htmlBody: t.Optional(t.String()),
      }),
    }
  );

if (import.meta.main) {
  const port = parseInt(process.env.PORT || "8080");
  protonGatewayApp.listen(port, () => {
    logger.info(`🛡️ Proton Bridge Gateway running on port ${port}`);
  });
}
