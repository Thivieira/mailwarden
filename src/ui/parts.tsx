import { doorsFor, SHUT_DOORS, uncoveredScopes } from "./doors";

/**
 * Pieces of The Hotel Key Card. Ordinary Solid components: compiled to SSR templates for
 * the Worker today, imported unchanged into SolidStart when the settings app lands.
 */

/** The printed band. The desk address is the anti-forgery line, so it is printed loud. */
export function Band(props: { host: string }) {
  return (
    <header class="band">
      <div class="band-inner">
        <p class="wordmark">Mailwarden</p>
        <p class="desk">
          This page is at <b>{props.host}</b>
        </p>
      </div>
    </header>
  );
}

/**
 * One drawn mark, two states. An authored key rather than a glyph, so the stroke matches
 * across every door and the meaning survives without colour.
 */
function KeyMark(props: { struck?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="10" r="3.2" />
      <path d="M9.4 10 H17" />
      <path d="M14 10 V13" />
      <path d="M16.6 10 V12.2" />
      {props.struck && <path d="M3.4 16.6 L16.6 3.4" />}
    </svg>
  );
}

export function OpenDoors(props: { scopes: string[]; mutationsEnabled: boolean }) {
  const doors = doorsFor(props.scopes);
  const leftover = uncoveredScopes(props.scopes);

  return (
    <section class="doors">
      <h2>What this key opens</h2>
      <ul>
        {doors.map((door) => {
          const off = door.simulatedWhenDryRun && !props.mutationsEnabled;
          return (
            <li>
              <span class="m" data-d={off ? "off" : "opens"}>
                <KeyMark />
              </span>
              <p class="what">{door.opens}</p>
              {off && (
                <p class="off-note">Switched off right now — Mailwarden will only pretend.</p>
              )}
              {door.note && <p class="note">{door.note}</p>}
            </li>
          );
        })}
        {/* Never hide a granted power because the plain-language list has not caught up. */}
        {leftover.map((scope) => (
          <li>
            <span class="m" data-d="opens">
              <KeyMark />
            </span>
            <p class="what">{scope}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShutDoors() {
  return (
    <section class="doors doors--shut">
      <h2>What it never opens</h2>
      <ul>
        {SHUT_DOORS.map((line) => (
          <li>
            <span class="m" data-d="shut">
              <KeyMark struck />
            </span>
            <p class="what">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The key itself: who holds it, and for how long. */
export function KeyCard(props: { holder: string; until: string }) {
  return (
    <div class="keycard">
      <p class="for">This key is for</p>
      <p class="holder">{props.holder}</p>
      <p class="until">{props.until}</p>
    </div>
  );
}

export function Field(props: {
  name: string;
  label: string;
  hint?: string;
  type: string;
  autocomplete: string;
  placeholder?: string;
}) {
  return (
    <p class="field">
      <label for={props.name}>{props.label}</label>
      {props.hint && <span class="hint">{props.hint}</span>}
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

export function Record(props: { facts: { term: string; value: string }[] }) {
  return (
    <dl class="record">
      {props.facts.map((fact) => (
        <div>
          <dt>{fact.term}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
