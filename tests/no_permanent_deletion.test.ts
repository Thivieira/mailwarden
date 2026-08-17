import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHUT_DOORS } from "../src/ui/doors";

/**
 * "Mailwarden moves mail, it never permanently deletes it" is printed to users on the
 * authorize page, in onboarding, and in both locales. It is true today only because no
 * code path can execute a delete against a provider.
 *
 * That is a load-bearing absence, and absences rot quietly. The policy layer already
 * accepts `delete` as a configurable action and only downgrades it to archive when the
 * matched policy is a system preset, so a user-created delete policy survives that guard
 * and is stopped solely by there being no executor.
 *
 * These tests fail the moment someone adds one, which forces the user-facing claim to be
 * revisited in the same change rather than silently becoming a lie.
 */

const SRC = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && full.endsWith(".ts") && !full.endsWith(".gen.ts") ? [full] : [];
  });
}

describe("No permanent deletion reaches a mail provider", () => {
  it("keeps delete out of the action type that can reach a provider", () => {
    const domain = readFileSync(join(SRC, "types", "domain.ts"), "utf8");
    const line = domain.split("\n").find((l) => l.includes("type MailboxActionType"))!;
    expect(line).toBeDefined();
    expect(line).toContain("archive");
    expect(line).not.toMatch(/delete/i);
  });

  it("exposes no delete operation on the provider interface", () => {
    const iface = readFileSync(join(SRC, "providers", "types.ts"), "utf8");
    expect(iface).toMatch(/archive\(/);
    expect(iface).not.toMatch(/\b(delete|trash|purge|destroy)\w*\(/i);
  });

  it("has no provider adapter issuing a destructive mailbox call", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, "providers"))) {
      const text = readFileSync(file, "utf8");
      if (/method:\s*["'`]DELETE|\/trash\b|messages\.delete|\.trash\(|batchDelete/i.test(text)) {
        offenders.push(file.replace(SRC, "src"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still tells users it never permanently deletes", () => {
    // If the guarantee above is ever relaxed, this line has to change with it.
    expect(SHUT_DOORS.some((line) => /never permanently deletes/i.test(line))).toBe(true);
  });
});
