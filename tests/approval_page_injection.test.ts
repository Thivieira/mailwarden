import { describe, expect, it } from "bun:test";
import { renderToString } from "solid-js/web";
import { document_ } from "../src/ui/document";
import { ApprovalReviewPage } from "../src/ui/approval.gen.js";

/**
 * The send-approval page renders a draft whose recipients, subject, and body can carry
 * text that arrived in an email. If that content can execute, prompt injection reaches
 * the confirmation nonce sitting in the same DOM and can approve a send with no human
 * involved - defeating the exact-payload invariant the whole safety model rests on.
 */
describe("Send approval page treats draft content as data", () => {
  const PAYLOAD = `<script>fetch('/api/approvals/x/confirm',{method:'POST'})</script>`;
  const NONCE = "nonce-abcdef123456";

  const render = (over: Record<string, string> = {}) =>
    document_(
      "Review outgoing email",
      renderToString(() =>
        ApprovalReviewPage({
          host: "mailwarden.corenet.workers.dev",
          state: "pending",
          recipients: "Someone <someone@example.com>",
          subject: "Quarterly numbers",
          body: "Hello there.",
          fingerprint: "a".repeat(64),
          approvalId: "apr_1",
          confirmationNonce: NONCE,
          ...over,
        })
      )
    );

  it("escapes an injected script in the body", () => {
    const html = render({ body: PAYLOAD });
    expect(html).not.toContain("<script>fetch(");
    // Solid escapes `<`, which is what prevents a tag from opening; a bare `>` is inert.
    expect(html).toContain("&lt;script");
  });

  it("escapes an injected script in the subject", () => {
    const html = render({ subject: PAYLOAD });
    expect(html).not.toContain("<script>fetch(");
  });

  it("escapes markup in the recipient list", () => {
    const html = render({ recipients: `<img src=x onerror=alert(1)> <a@b.c>` });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("does not let an attacker close the hidden nonce input", () => {
    const html = render({ subject: `"><script>steal()</script>` });
    expect(html).not.toContain("<script>steal()");
    // The nonce is still present exactly once, in its own field.
    expect(html.split(NONCE).length - 1).toBe(1);
  });

  it("shows the confirm form only while the request is still pending", () => {
    expect(render()).toContain("/api/approvals/apr_1/confirm");
    for (const state of ["confirmed", "expired", "sent"]) {
      const html = render({ state });
      expect(html).not.toContain("/api/approvals/apr_1/confirm");
      expect(html).not.toContain(NONCE);
    }
  });
});
