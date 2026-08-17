import { Alert, Field, GrantSubject, OpenDoors, Record, ShutDoors, SiteHeader } from "./parts";

/**
 * The browser-facing surfaces, written for someone who has never heard of OAuth. Each
 * answers the three questions a nervous person actually has: is this safe, what exactly
 * can it do, and can I undo it.
 */

const HIDDEN_FIELDS = [
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

export function AuthorizePage(props: {
  host: string;
  clientName: string;
  scopes: string[];
  mutationsEnabled: boolean;
  params: Record<string, string>;
}) {
  return (
    <>
      <SiteHeader host={props.host} />
      <main class="sheet">
        <h1>Give {props.clientName} access to your email?</h1>
        <p class="lede">
          Mailwarden holds your email accounts for you. Signing in below lets{" "}
          {props.clientName} use some of what Mailwarden can do. Not your email
          password, and nothing that sends mail without your say-so.
        </p>

        <GrantSubject
          name={props.clientName}
          meta="Asking for access to your Mailwarden account"
          badge="Revocable any time"
        />

        {/* Sign-in comes before the permission lists: most people arrive intending to
            approve, and 450px of scroll to reach the password field is the wrong tax. The
            lists stay on the page, folded, and the summaries below state the grant in full
            so nothing is hidden from someone who never opens them. */}
        <form method="post" action="/oauth/authorize">
          {HIDDEN_FIELDS.map((name) => (
            <input type="hidden" name={name} value={props.params[name] ?? ""} />
          ))}
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Sign in to continue</h2>
              <p class="card-desc">Your Mailwarden account, not your email provider.</p>
            </div>
            <div class="card-content">
              <Field
                name="email"
                label="Email address"
                type="email"
                autocomplete="username"
                placeholder="you@example.com"
                error="That does not look like an email address. Check for a typo."
              />
              <Field
                name="login_secret"
                label="Password"
                hint="Sometimes called your login secret: the one you were given when your account was set up."
                type="password"
                autocomplete="current-password"
                placeholder="mw_…"
                peek
                error="Enter your password to continue."
              />
              <button type="submit">Allow access</button>
            </div>
          </section>
        </form>

        <OpenDoors scopes={props.scopes} mutationsEnabled={props.mutationsEnabled} />
        <ShutDoors />

        <p class="footnote">
          You can take this access away at any time and {props.clientName} loses it
          immediately. Before you type anything, check your browser’s address bar says{" "}
          <strong>{props.host}</strong>. If it says anything else, close the tab.
        </p>
      </main>
    </>
  );
}

export function DeniedPage(props: { host: string }) {
  return (
    <>
      <SiteHeader host={props.host} />
      <main class="sheet">
        <h1>That didn’t match</h1>
        <Alert
          tone="no"
          title="The email address and password you entered don’t match a Mailwarden account."
          detail="Nothing was shared and no access was given. Go back and try again."
        />
        <p class="footnote">
          If you’ve lost your password it can be replaced with a new one. It can’t be
          looked up, because Mailwarden doesn’t keep a copy of it.
        </p>
      </main>
    </>
  );
}

export function CallbackPage(props: {
  host: string;
  granted: boolean;
  headline: string;
  detail: string;
  facts: { term: string; value: string }[];
}) {
  return (
    <>
      <SiteHeader host={props.host} />
      <main class="sheet">
        <h1>{props.headline}</h1>
        <Alert tone={props.granted ? "yes" : "no"} title={props.detail} />

        {props.facts.length > 0 && (
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">Connection details</h2>
            </div>
            <Record facts={props.facts} />
          </section>
        )}

        <p class="footnote">
          Close this tab and go back to your conversation. Mailwarden keeps the mailbox
          up to date in the background.
        </p>
      </main>
    </>
  );
}
