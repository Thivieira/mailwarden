import { Band } from "./parts";

/**
 * The send-approval pages: the human-in-the-loop moment the whole safety model rests on.
 *
 * Everything shown here is untrusted. A draft's recipients, subject, and body can carry
 * content that arrived in an email, so this must never be assembled by string
 * interpolation - Solid's compiler escapes every value, and renderPage puts a
 * script-forbidding CSP in front of it.
 */

export type ApprovalState = "pending" | "confirmed" | "expired" | "sent";

const STATE_LINE: Record<ApprovalState, string> = {
  pending: "Nothing has been sent. Read it below and decide.",
  confirmed: "You approved this. Go back to your conversation to finish sending.",
  expired: "This request has expired, so it can no longer be approved. Ask for it again.",
  sent: "This email has already been sent.",
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
  return (
    <>
      <Band host={props.host} />
      <main class="sheet">
        <h1>Send this email?</h1>
        <p class="lede">
          This is exactly what will go out, word for word. Nothing is sent until you say
          so on this page.
        </p>

        <div class="outcome">
          <p>{STATE_LINE[props.state]}</p>
        </div>

        <article class="letter">
          <div class="letter-row">
            <p class="letter-label">To</p>
            <p class="letter-value">{props.recipients}</p>
          </div>
          <div class="letter-row">
            <p class="letter-label">Subject</p>
            <p class="letter-value">{props.subject}</p>
          </div>
          <div class="letter-body">{props.body}</div>
        </article>

        {props.state === "pending" && (
          <form method="post" action={`/api/approvals/${props.approvalId}/confirm`}>
            <input type="hidden" name="confirmationNonce" value={props.confirmationNonce} />
            <div class="signin">
              <p class="confirm-note">
                If a single word of this email changes, this approval stops counting and
                you will be asked again.
              </p>
              <button type="submit">Yes — send this email</button>
            </div>
          </form>
        )}

        <p class="handback">
          Message fingerprint <code>{props.fingerprint}</code>. You can ignore this — it is
          how Mailwarden checks that what you approved is what actually gets sent.
        </p>
      </main>
    </>
  );
}

export function ApprovalConfirmedPage(props: { host: string; approvalId: string }) {
  return (
    <>
      <Band host={props.host} />
      <main class="sheet">
        <h1>Approved</h1>
        <div class="outcome">
          <p>
            You have approved this email. Go back to your conversation and Mailwarden will
            finish sending it.
          </p>
        </div>
        <p class="handback">
          Reference <code>{props.approvalId}</code>. If the email is edited after this
          point, your approval no longer counts and you will be asked again.
        </p>
      </main>
    </>
  );
}
