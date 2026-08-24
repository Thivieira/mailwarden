export interface ProtonBridgeCredentials {
  mode?: "gateway" | "direct";
  gatewayUrl?: string;
  gatewayApiKey?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  bridgeUsername?: string;
  bridgePassword?: string;
  /**
   * Per-device gateway secret for a registered relay. When present, Cloud signs
   * each request with it instead of sending a bearer token, so the credential
   * never travels and a captured request cannot be replayed.
   */
  deviceGatewaySecret?: string;
  /** The relay device serving this mailbox, for audit and diagnostics. */
  relayDeviceId?: string;
}

export function validateProtonGatewayUrl(value: string): URL {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new TypeError(`Proton gateway URL must use HTTPS: ${value}`);
  if (url.hostname === "169.254.169.254" || url.hostname === "metadata.google.internal") {
    throw new TypeError("Proton gateway URL cannot target internal cloud metadata endpoints");
  }
  return url;
}

export * from "./discovery";
