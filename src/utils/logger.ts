import { config } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Mask sensitive field values to prevent accidental credential leakage
const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "refreshtoken",
  "accesstoken",
  "authorization",
  "credential",
  "encrypteddata",
  "key",
  "client_secret",
  "clientsecret",
]);

function sanitizeLogObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogObject(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("secret") || lowerKey.includes("token")) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      sanitized[key] = sanitizeLogObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class Logger {
  private contextName: string;

  constructor(contextName: string = "Mailwarden") {
    this.contextName = contextName;
  }

  private shouldLog(level: LogLevel): boolean {
    const currentPriority = LEVEL_PRIORITY[config.LOG_LEVEL];
    const targetPriority = LEVEL_PRIORITY[level];
    return targetPriority >= currentPriority;
  }

  private formatPretty(level: LogLevel, message: string, data?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[90m", // Gray
      info: "\x1b[36m",  // Cyan
      warn: "\x1b[33m",  // Yellow
      error: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const levelStr = `${colors[level]}${level.toUpperCase().padEnd(5)}${reset}`;
    const ctx = `\x1b[35m[${this.contextName}]\x1b[0m`;

    let out = `${timestamp} ${levelStr} ${ctx} ${message}`;
    if (data && Object.keys(data).length > 0) {
      const sanitized = sanitizeLogObject(data);
      out += ` ${JSON.stringify(sanitized)}`;
    }
    return out;
  }

  private formatJson(level: LogLevel, message: string, data?: Record<string, any>): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.contextName,
      message,
      ...(data ? { data: sanitizeLogObject(data) } : {}),
    };
    return JSON.stringify(logEntry);
  }

  private write(level: LogLevel, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog(level)) return;

    const formatted =
      config.LOG_FORMAT === "json"
        ? this.formatJson(level, message, data)
        : this.formatPretty(level, message, data);

    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, any>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, any>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, any>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, any>): void {
    this.write("error", message, data);
  }

  child(subContext: string): Logger {
    return new Logger(`${this.contextName}:${subContext}`);
  }
}

export const logger = new Logger("Mailwarden");
