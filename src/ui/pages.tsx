import { Band, Field, KeyCard, OpenDoors, Record, ShutDoors } from "./parts";

/**
 * The four browser-facing surfaces, written for someone who has never heard of OAuth.
 * Each answers the three questions a nervous person actually has: is this safe, what
 * exactly can it do, and can I undo it.
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
      <Band host={props.host} />
      <main class="sheet">
        <h1>Give {props.clientName} a key to your email?</h1>
        <p class="lede">
          Mailwarden holds your email accounts for you. Signing in here hands{" "}
          {props.clientName} a key to <em>some</em> of what Mailwarden can do — never your
          email password, and never anything that sends mail without your say-so.
        </p>

        <KeyCard holder={props.clientName} until="Works until you hand it back." />

        <OpenDoors scopes={props.scopes} mutationsEnabled={props.mutationsEnabled} />
        <ShutDoors />

        <form method="post" action="/oauth/authorize">
          {HIDDEN_FIELDS.map((name) => (
            <input type="hidden" name={name} value={props.params[name] ?? ""} />
          ))}
          <div class="signin">
            <Field
              name="email"
              label="Your email address"
              hint="The one you use for Mailwarden."
              type="email"
              autocomplete="username"
              placeholder="you@example.com"
            />
            <Field
              name="login_secret"
              label="Your Mailwarden password"
              hint="Sometimes called your login secret — the one you were given when your account was set up."
              type="password"
              autocomplete="current-password"
            />
            <button type="submit">Give {props.clientName} the key</button>
          </div>
        </form>

        <p class="handback">
          You can take this key back at any time, and {props.clientName} loses access
          immediately. Before you type anything, check your browser’s address bar says{" "}
          <strong>{props.host}</strong> — if it says anything else, close the tab.
        </p>
      </main>
    </>
  );
}

export function DeniedPage(props: { host: string }) {
  return (
    <>
      <Band host={props.host} />
      <main class="sheet">
        <h1>That didn’t match</h1>
        <div class="outcome">
          <p>
            The email address and password you entered don’t match a Mailwarden account.
            No key was handed over and nothing was opened.
          </p>
          <p>Go back and try again.</p>
        </div>
        <p class="handback">
          If you’ve lost your password, it can be replaced with a new one — it can’t be
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
      <Band host={props.host} />
      <main class="sheet">
        <h1>{props.headline}</h1>
        <div class="outcome">
          <p>{props.detail}</p>
        </div>
        {props.facts.length > 0 && <Record facts={props.facts} />}
        <p class="handback">
          You can close this tab and go back to your conversation. Mailwarden keeps things
          up to date in the background.
        </p>
      </main>
    </>
  );
}
