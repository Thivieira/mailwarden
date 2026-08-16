import { FingerprintBlock, Field, OriginStrip, ScopeManifest } from "./parts";

/**
 * The four browser-facing surfaces. Each is a 20-40 second interstitial between an AI
 * client and a mailbox, so every one names where it is, what is being granted, and how
 * to get back to the conversation.
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
  rows: string[];
  digest: string;
  params: Record<string, string>;
}) {
  return (
    <main class="sheet">
      <OriginStrip host={props.host} label="Mailwarden authorization" />

      <h1>Grant {props.clientName} access to your vault</h1>
      <p class="lede">
        Your vault is yours alone. Connected accounts, credentials, drafts, relationship
        memory, and rules stay isolated from every other Mailwarden user — and{" "}
        {props.clientName} never receives your Gmail, Outlook, or Proton passwords.
      </p>

      <FingerprintBlock
        caption="This request"
        rows={props.rows}
        digest={props.digest}
        facts={[
          { term: "Client", value: props.clientName },
          { term: "Returns to", value: props.params.redirect_uri ?? "—" },
        ]}
      />

      <div style="margin-top:2rem">
        <ScopeManifest scopes={props.scopes} mutationsEnabled={props.mutationsEnabled} />
      </div>

      <form method="post" action="/oauth/authorize">
        {HIDDEN_FIELDS.map((name) => (
          <input type="hidden" name={name} value={props.params[name] ?? ""} />
        ))}
        <div class="entry">
          <Field
            name="email"
            label="Vault email"
            type="email"
            autocomplete="username"
            placeholder="you@example.com"
          />
          <Field
            name="login_secret"
            label="Vault login secret"
            type="password"
            autocomplete="current-password"
          />
          <button type="submit">Authorize {props.clientName}</button>
        </div>
      </form>

      <p class="note">
        Check the fingerprint above against the one you saw last time. It is drawn from
        this exact request, so a page that looks like this one but was not served by{" "}
        {props.host} will draw a different picture.
      </p>
    </main>
  );
}

export function DeniedPage(props: { host: string; reason: string }) {
  return (
    <main class="sheet">
      <OriginStrip host={props.host} label="Mailwarden authorization" />
      <h1>Authorization denied</h1>
      <div class="outcome" data-state="denied">
        <p>{props.reason}</p>
        <p>
          Nothing was granted and no vault was opened. Go back and try again with the
          email and login secret issued for your vault.
        </p>
      </div>
      <p class="note">
        If you have lost your login secret, it can be rotated — a lost secret is replaced,
        never recovered.
      </p>
    </main>
  );
}

export function CallbackPage(props: {
  host: string;
  provider: string;
  granted: boolean;
  headline: string;
  detail: string;
  facts: { term: string; value: string }[];
}) {
  return (
    <main class="sheet">
      <OriginStrip host={props.host} label={`${props.provider} connection`} />
      <h1>{props.headline}</h1>
      <div class="outcome" data-state={props.granted ? "granted" : "denied"}>
        <p>{props.detail}</p>
      </div>

      {props.facts.length > 0 && (
        <table class="manifest" style="margin-top:2rem">
          <caption>Connection record</caption>
          <tbody>
            {props.facts.map((fact) => (
              <tr>
                <th scope="row">{fact.term}</th>
                <td>{fact.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p class="note">
        You can close this tab and return to your conversation. Mailwarden keeps syncing
        in the background.
      </p>
    </main>
  );
}
