import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  MCP_BASE_URL: z.string().url().default("http://localhost:3000/mcp"),

  DATABASE_URL: z.string().default("./data/mailwarden.db"),

  AUTH_SECRET: z.string().min(16).default("mailwarden-dev-jwt-secret-at-least-32-chars-long!"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  KEY_VERSION: z.string().default("v1"),

  // Personal dogfood / owner authentication. In production both should be configured as Worker secrets/vars.
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_LOGIN_SECRET: z.string().min(12).optional(),
  ALLOW_DEV_AUTH: z
    .string()
    .default("false")
    .transform((val) => val === "true" || val === "1"),

  MAILBOX_MUTATIONS_ENABLED: z
    .string()
    .default("false")
    .transform((val) => val === "true" || val === "1"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // Microsoft OAuth
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT_ID: z.string().default("common"),

  // Proton Mail Bridge
  PROTON_BRIDGE_HOST: z.string().default("127.0.0.1"),
  PROTON_BRIDGE_IMAP_PORT: z.coerce.number().default(1143),
  PROTON_BRIDGE_SMTP_PORT: z.coerce.number().default(1025),
  PROTON_BRIDGE_USERNAME: z.string().optional(),
  PROTON_BRIDGE_PASSWORD: z.string().optional(),
  PROTON_BRIDGE_TLS_MODE: z.enum(["STARTTLS", "TLS", "NONE"]).default("STARTTLS"),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
});

export type Config = z.infer<typeof configSchema>;

let parsedConfig: Config | null = null;

export function updateConfig(customEnv: Record<string, any>): Config {
  const merged = { ...process.env, ...customEnv };
  parsedConfig = configSchema.parse(merged);
  return parsedConfig;
}

export function getConfig(): Config {
  if (parsedConfig) return parsedConfig;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`❌ Mailwarden Configuration Error:\n${errorDetails}`);
    throw new Error(`Invalid Mailwarden configuration:\n${errorDetails}`);
  }

  parsedConfig = result.data;
  return parsedConfig;
}

export const config: Config = new Proxy({} as Config, {
  get(_target, prop) {
    const current = parsedConfig || getConfig();
    return (current as any)[prop];
  },
});
