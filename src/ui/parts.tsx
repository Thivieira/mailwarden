import { scopeReading, scopeState, STATE_WORD } from "./scopes";
import { frameCells } from "./randomart";

/**
 * Shared pieces of The Fingerprint Block. These are ordinary Solid components: they are
 * compiled to SSR templates for the Worker today, and import unchanged into SolidStart
 * when the settings app lands.
 */

/** Where the page actually is. First thing rendered, because it is what gets forged. */
export function OriginStrip(props: { host: string; label: string }) {
  return (
    <p class="origin">
      <span>{props.label}</span>
      <span>
        served by <b>{props.host}</b>
      </span>
    </p>
  );
}

/**
 * The page's largest object: a visual hash of the exact request, beside its digest.
 * Two different requests draw visibly different pictures, so a returning user recognizes
 * their own and a forged page cannot reproduce one without the same inputs.
 */
export function FingerprintBlock(props: {
  caption: string;
  rows: string[];
  digest: string;
  facts: { term: string; value: string }[];
}) {
  return (
    <figure class="block" style="margin:0">
      <figcaption>
        <span>{props.caption}</span>
        <span>SHA-256</span>
      </figcaption>
      <div class="art">
        <pre aria-label={`Visual fingerprint of this request, digest ${props.digest}`}>
          {frameCells(props.rows).map((row) => [
            ...row.map((cell) =>
              cell.tone === "dense" ? cell.ch : <span data-t={cell.tone}>{cell.ch}</span>
            ),
            "\n",
          ])}
        </pre>
        <dl>
          <div>
            <dt>Request digest</dt>
            <dd class="digest">{props.digest}</dd>
          </div>
          {props.facts.map((fact) => (
            <div>
              <dt>{fact.term}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </figure>
  );
}

/**
 * Every requested power, in plain language. State is carried by the word first and the
 * hue second, so the manifest reads correctly without color.
 */
export function ScopeManifest(props: { scopes: string[]; mutationsEnabled: boolean }) {
  return (
    <table class="manifest">
      <caption>Powers this grant confers</caption>
      <tbody>
        {props.scopes.map((scope) => {
          const state = scopeState(scope, props.mutationsEnabled);
          return (
            <tr>
              <th scope="row" data-label="Scope">
                {scope}
              </th>
              <td data-label="Permits">{scopeReading(scope)}</td>
              <td class="mark" data-state={state} data-label="State">
                {STATE_WORD[state]}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Field(props: {
  name: string;
  label: string;
  type: string;
  autocomplete: string;
  placeholder?: string;
}) {
  return (
    <p class="field" style="margin:0">
      <label for={props.name}>{props.label}</label>
      <input
        id={props.name}
        name={props.name}
        type={props.type}
        autocomplete={props.autocomplete}
        placeholder={props.placeholder}
        required
        spellcheck={false}
        autocapitalize="none"
      />
    </p>
  );
}
