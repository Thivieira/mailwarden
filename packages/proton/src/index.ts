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
