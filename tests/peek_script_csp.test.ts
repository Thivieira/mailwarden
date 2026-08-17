import { describe, expect, it } from "bun:test";
import { PEEK_SCRIPT } from "../src/ui/peek";
import { PEEK_SHA256 } from "../src/ui/peek.gen";
import { renderPage } from "../src/ui/render";

/**
 * The authorize page admits exactly one inline script, by hash. These tests exist because
 * every failure mode here is silent: a stale hash does not throw, it just stops the script
 * from running; and a CSP loosened for one page is easy to leak onto the page that renders
 * untrusted email content.
 */
describe("Password peek script and its CSP hash", () => {
  const csp = (r: Response) => r.headers.get("content-security-policy") ?? "";

  it("hash in peek.gen.ts matches the current script bytes", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PEEK_SCRIPT));
    expect(PEEK_SHA256).toBe(`sha256-${Buffer.from(digest).toString("base64")}`);
  });

  it("pages that do not opt in still forbid script entirely", () => {
    const policy = csp(renderPage("Plain", () => "<p>hi</p>"));
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain("script-src");
    expect(policy).not.toContain("unsafe-inline'; script");
  });

  it("the opted-in page allows the peek script and nothing else", () => {
    const policy = csp(renderPage("Peek", () => "<p>hi</p>", 200, { peek: true }));
    expect(policy).toContain(`script-src '${PEEK_SHA256}'`);
    // No blanket escape hatch may accompany the hash, or the hash is decorative.
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src *");
  });

  it("only the opted-in page carries the script in its body", () => {
    expect(renderPage("Peek", () => "<p>hi</p>", 200, { peek: true })).toBeDefined();
    const withPeek = renderPage("Peek", () => "<p>hi</p>", 200, { peek: true });
    const without = renderPage("Plain", () => "<p>hi</p>");
    return Promise.all([withPeek.text(), without.text()]).then(([a, b]) => {
      expect(a).toContain("data-peek");
      expect(b).not.toContain("<script");
    });
  });

  it("the send-approval page never opts in", async () => {
    const { ApprovalReviewPage } = await import("../src/ui/approval.gen.js");
    const page = renderPage("Review", () =>
      (ApprovalReviewPage as any)({
        host: "example.test",
        state: "pending",
        fromAddress: "from@example.com",
        recipients: "a@b.test",
        cc: "None",
        bcc: "None / unsupported",
        subject: "s",
        body: "b",
        threadContext: "New conversation",
        attachments: "None",
        fingerprint: "f",
        approvalId: "id",
        confirmationNonce: "n",
      })
    );
    expect(csp(page)).not.toContain("script-src");
    expect(await page.text()).not.toContain("<script");
  });
});
