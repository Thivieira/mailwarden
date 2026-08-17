import { Alert, SiteHeader } from "./parts";

/**
 * The send-approval pages: the human-in-the-loop moment the whole safety model rests on.
 *
 * Everything shown here is untrusted. A draft's recipients, subject, and body can carry
 * content that arrived in an email, so this must never be assembled by string
 * interpolation - Solid's compiler escapes every value, and renderPage puts a
 * script-forbidding CSP in front of it.
 */

export type ApprovalState = "pending" | "confirmed" | "expired" | "sent";

const STATE: Record<ApprovalState, { tone: "yes" | "no" | "info"; line: string }> = {
  pending: { tone: "info", line: "Nothing has been sent. Read it below and decide." },
  confirmed: {
    tone: "yes",
    line: "You approved this. Go back to your conversation to finish sending.",
  },
  expired: {
    tone: "no",
    line: "This request expired, so it can no longer be approved. Ask for it again.",
  },
  sent: { tone: "yes", line: "This email has already been sent." },
};

export function ApprovalReviewPage(props: {
  host: string;
  state: ApprovalState;
  recipients: string;
  subject: string;
  body: string;
  fingerprint: string;
  approvalId: string;
  confirmationNonce: string;
}) {
  const status = STATE[props.state];
  return (
    <>
      <SiteHeader host={props.host} />
      <main class="sheet">
        <h1>Send this email?</h1>
        <p class="lede">
          This is exactly what will go out, word for word. Nothing is sent until you say so
          on this page.
        </p>

        <Alert tone={status.tone} title={status.line} />

        <article class="card">
          <div class="letter-meta">
            <p class="letter-key">To</p>
            <p class="letter-val">{props.recipients}</p>
          </div>
          <div class="letter-meta">
            <p class="letter-key">Subject</p>
            <p class="letter-val">{props.subject}</p>
          </div>
          <div class="letter-body">{props.body}</div>
        </article>

        {props.state === "pending" && (
          <form method="post" action={`/api/approvals/${props.approvalId}/confirm`}>
            <input type="hidden" name="confirmationNonce" value={props.confirmationNonce} />
            <section class="card">
              <div class="card-content">
                <p class="card-desc" style="margin:0 0 1rem">
                  If a single word of this email changes, this approval stops counting and
                  you will be asked again.
                </p>
                <button type="submit">Yes, send this email</button>
              </div>
            </section>
          </form>
        )}

        <p class="footnote">
          You can ignore the line below. It is how Mailwarden checks that what you approved
          is what actually gets sent.
          {/* Rendered verbatim, never regrouped: tests/send_approval.test.ts pins that this
              page carries the exact payload hash, and it has to stay copy-pastable. */}
          <code class="fingerprint">{props.fingerprint}</code>
        </p>
      </main>
    </>
  );
}

export function ApprovalConfirmedPage(props: { host: string; approvalId: string }) {
  return (
    <>
      <SiteHeader host={props.host} />
      <main class="sheet">
        <h1>Approved</h1>
        <Alert
          tone="yes"
          title="You have approved this email."
          detail="Go back to your conversation and Mailwarden will finish sending it."
        />
        <p class="footnote">
          Reference <code>{props.approvalId}</code>. If the email is edited after this
          point your approval no longer counts and you will be asked again.
        </p>
      </main>
    </>
  );
}
