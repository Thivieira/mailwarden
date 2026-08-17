import { doorsFor, SHUT_DOORS, uncoveredScopes } from "./doors";

/**
 * shadcn/ui New York components, expressed as zero-JS Solid SSR.
 *
 * Icons follow Lucide's drawing spec exactly - 24 viewBox, 2px stroke, round caps and
 * joins, rendered at 16px - so they sit in the system the way Lucide would.
 */

function Icon(props: { children: any; size?: number }) {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

const Check = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

const X = () => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

const KeyRound = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </Icon>
);

const CircleCheck = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

const CircleAlert = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
);

/**
 * One icon per power, so the list is scannable at a glance rather than seven identical
 * checks. Geometry is Lucide's, keyed by the `icon` field in doors.ts - keep the two in
 * step, and fall back to a check rather than rendering nothing.
 */
const DOOR_ICONS: Record<string, () => any> = {
  "mail-open": () => (
    <Icon>
      <path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z" />
      <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
    </Icon>
  ),
  "pen-line": () => (
    <Icon>
      <path d="M13 21h8" />
      <path d="m15 5 4 4" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </Icon>
  ),
  send: () => (
    <Icon>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </Icon>
  ),
  archive: () => (
    <Icon>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </Icon>
  ),
  eye: () => (
    <Icon>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  bookmark: () => (
    <Icon>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Icon>
  ),
  "at-sign": () => (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </Icon>
  ),
};

/** The sticky header. The host is the anti-forgery line and stays visible while scrolling. */
export function SiteHeader(props: { host: string }) {
  return (
    <header class="site-header">
      <div class="site-header-inner">
        <p class="brand">
          <KeyRound size={17} />
          Mailwarden
        </p>
        <p class="host">
          This page is at <b>{props.host}</b>
        </p>
      </div>
    </header>
  );
}

/** The account row shadcn uses to show who a grant is for. */
export function GrantSubject(props: { name: string; meta: string; badge: string }) {
  return (
    <div class="card">
      <div class="subject">
        <span class="avatar" aria-hidden="true">
          {props.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p class="subject-name">{props.name}</p>
          <p class="subject-meta">{props.meta}</p>
        </div>
        <span class="badge">{props.badge}</span>
      </div>
    </div>
  );
}

export function OpenDoors(props: { scopes: string[]; mutationsEnabled: boolean }) {
  const doors = doorsFor(props.scopes);
  const leftover = uncoveredScopes(props.scopes);

  return (
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">What it will be able to do</h2>
        <p class="card-desc">Only these things, and nothing beyond them.</p>
      </div>
      <ul class="rows">
        {doors.map((door) => {
          const off = door.simulatedWhenDryRun && !props.mutationsEnabled;
          const Glyph = DOOR_ICONS[door.icon] ?? Check;
          return (
            <li>
              <span class="icon" data-tone={off ? "" : "yes"}>
                <Glyph />
              </span>
              <p class="row-title">{door.opens}</p>
              {off && <span class="row-flag">Switched off right now</span>}
              {door.note && <p class="row-note">{door.note}</p>}
            </li>
          );
        })}
        {/* Never hide a granted power because the plain-language list has not caught up. */}
        {leftover.map((scope) => (
          <li>
            <span class="icon" data-tone="yes">
              <Check />
            </span>
            <p class="row-title">{scope}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShutDoors() {
  return (
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">What it will never be able to do</h2>
        <p class="card-desc">Mailwarden's servers enforce this. The assistant cannot override it.</p>
      </div>
      <ul class="rows">
        {SHUT_DOORS.map((line) => (
          <li>
            <span class="icon" data-tone="no">
              <X />
            </span>
            <p class="row-title">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Alert(props: { tone: "yes" | "no" | "info"; title: string; detail?: string }) {
  return (
    <div class="alert" data-tone={props.tone}>
      <span class="icon">{props.tone === "yes" ? <CircleCheck /> : <CircleAlert />}</span>
      <p>{props.title}</p>
      {props.detail && <p>{props.detail}</p>}
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
