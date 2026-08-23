/**
 * Bridge logging. Deliberately independent of Cloud's logger so Bridge Core can
 * ship without the Worker runtime, and deliberately redacting: Proton Bridge
 * passwords, device secrets, and tunnel tokens must never reach a log file, a
 * journal, or a diagnostics bundle.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SENSITIVE = /(password|secret|token|credential|authorization|apikey|api_key)/i;

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE.test(key) ? "[REDACTED]" : redact(entry);
  }
  return output;
}

export type BridgeLogger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

export function createLogger(minimum: LogLevel = "info"): BridgeLogger {
  return (level, message, fields) => {
    if (ORDER[level] < ORDER[minimum]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [bridge] ${message}`;
    const payload = fields ? ` ${JSON.stringify(redact(fields))}` : "";
    if (level === "error") console.error(line + payload);
    else if (level === "warn") console.warn(line + payload);
    else console.log(line + payload);
  };
}

export const noopLogger: BridgeLogger = () => {};
