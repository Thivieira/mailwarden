import { describe, it, expect } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Invariant 2 (see CLAUDE.md): MailScribe core must never require a
 * MailScribe-funded LLM call to produce or maintain inbox state.
 *
 * Semantic judgment is executed by the external MCP client using the user's own
 * AI entitlement. An internal "just a small fast model for triage" tier is the
 * regression this guards against, and it always arrives as a dependency first.
 */

const INFERENCE_SDKS = [
  "@anthropic-ai/sdk",
  "@anthropic-ai/bedrock-sdk",
  "@anthropic-ai/vertex-sdk",
  "openai",
  "@azure/openai",
  "@google/generative-ai",
  "@google-cloud/aiplatform",
  "cohere-ai",
  "@mistralai/mistralai",
  "replicate",
  "groq-sdk",
  "langchain",
  "@langchain/core",
  "llamaindex",
  "ai", // Vercel AI SDK
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function workspacePackageJsonPaths(): string[] {
  const root = join(import.meta.dir, "..");
  const paths = [join(root, "package.json")];

  for (const workspace of ["apps", "packages"]) {
    const dir = join(root, workspace);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = join(dir, entry.name, "package.json");
      if (existsSync(pkg)) paths.push(pkg);
    }
  }

  return paths;
}

describe("architecture invariants", () => {
  it("declares no paid inference SDK in any workspace package", async () => {
    const offenders: string[] = [];

    for (const path of workspacePackageJsonPaths()) {
      const pkg = await Bun.file(path).json();
      for (const field of DEPENDENCY_FIELDS) {
        const deps = pkg[field];
        if (!deps) continue;
        for (const sdk of INFERENCE_SDKS) {
          if (deps[sdk]) offenders.push(`${path} → ${field}.${sdk}`);
        }
      }
    }

    // A failure here is an architecture decision, not a lint error. Read
    // invariant 2 in CLAUDE.md before changing this test.
    expect(offenders).toEqual([]);
  });

  it("keeps the Cloudflare Workers AI binding out of the runtime config", async () => {
    // Workers AI is billable inference inside MailScribe's own account, which is
    // the same violation as an SDK dependency with a different invoice.
    const wrangler = await Bun.file(join(import.meta.dir, "..", "wrangler.jsonc")).text();
    const stripped = wrangler.replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/"ai"\s*:/);
    expect(stripped).not.toMatch(/@cf\//);
  });
});
