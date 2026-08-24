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

export const Check = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const X = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

/**
 * The Mailwarden seal, and the only drawing here that is not Lucide's.
 *
 * A shield whose body is also an envelope: one outline does both jobs, with the flap
 * struck across it. Authored rather than imported, but held to Lucide's spec - 24 viewBox,
 * 2px stroke, round caps and joins - so it sits inside the icon system instead of beside
 * it. This is the mark; do not swap it for a stock glyph.
 */
export const Seal = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m7.5 9.5 4.5 3.5 4.5-3.5" />
  </Icon>
);

export const CircleCheck = (props: { size?: number }) => (
  <Icon size={props.size}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const Eye = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOff = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </Icon>
);

export const ChevronDown = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronRight = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const CircleAlert = (props: { size?: number }) => (
  <Icon size={props.size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Icon>
);

export const UserIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);

export const BuildingIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </Icon>
);

export const BotIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </Icon>
);

export const CopyIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

export const SyncIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </Icon>
);

export const LogOutIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </Icon>
);

export const PlusIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
);

export const TrashIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </Icon>
);

export const ShieldCheckIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const MailIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </Icon>
);

export const UsersIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

export const ZapIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </Icon>
);

export const LaptopIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />
  </Icon>
);

export const KeyIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3L22 7l-3-3" />
  </Icon>
);

export const TerminalIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </Icon>
);

export const ServerIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <line x1="6" x2="6.01" y1="6" y2="6" />
    <line x1="6" x2="6.01" y1="18" y2="18" />
  </Icon>
);

export const SearchIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

export const SettingsIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const SparklesIcon = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </Icon>
);

export const GoogleBrandIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.46 7.34 24 12 24z" />
    <path fill="#FBBC05" d="M5.28 14.27A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.57.38-2.27V6.58H1.24A11.96 11.96 0 0 0 0 12c0 1.92.45 3.74 1.24 5.42l4.04-3.15z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.54 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
  </svg>
);

export const MicrosoftBrandIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#F25022" d="M1 1h10v10H1z" />
    <path fill="#7FBA00" d="M13 1h10v10H13z" />
    <path fill="#00A4EF" d="M1 13h10v10H1z" />
    <path fill="#FFB900" d="M13 13h10v10H13z" />
  </svg>
);

export const ProtonBrandIcon = (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#6d4aff" stroke="#6d4aff" />
    <path d="m9 12 2 2 4-4" stroke="#ffffff" stroke-width="2.5" />
  </svg>
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
export function SiteHeader(props: { host: string; showSignOut?: boolean; wide?: boolean }) {
  return (
    <header class="site-header">
      <div class={`site-header-inner ${props.wide ? "is-wide" : ""}`}>
        <a href="/" class="brand" style="text-decoration: none; color: inherit; display: inline-flex; align-items: center; gap: 0.5rem;">
          <Seal size={18} />
          <span>Mailwarden</span>
        </a>
        <div style="display: flex; align-items: center; gap: 0.85rem;">
          <p class="host" style="margin: 0;">
            This page is at <b>{props.host}</b>
          </p>
          {props.showSignOut && (
            <a
              href="/portal/logout"
              class="btn btn-secondary btn-sm"
              style="text-decoration: none;"
            >
              Sign Out
            </a>
          )}
        </div>
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

/**
 * The permission lists fold, because the sign-in field now sits above them and most
 * people go straight for it. `<details>` does this natively - the CSP forbids script, so
 * a scripted accordion is not available and would be the wrong tool anyway.
 *
 * The summary is not a label: it carries the count and the guarantee, so the grant is
 * still stated on the page for someone who never opens either list.
 */
function Disclosure(props: { title: string; summary: string; children: any; lock?: boolean }) {
  return (
    <details class="card" data-lock={props.lock ? "" : undefined} data-open={props.lock ? undefined : ""}>
      <summary class="card-header">
        <div>
          <h2 class="card-title">{props.title}</h2>
          <p class="card-desc">{props.summary}</p>
        </div>
        <span class="chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </summary>
      {props.children}
    </details>
  );
}

export function OpenDoors(props: { scopes: string[]; mutationsEnabled: boolean }) {
  const doors = doorsFor(props.scopes);
  const leftover = uncoveredScopes(props.scopes);
  const count = doors.length + leftover.length;

  return (
    <Disclosure
      title="What it will be able to do"
      summary={`${count} ${count === 1 ? "thing" : "things"}, and nothing beyond them. Tap to read each one.`}
    >
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
    </Disclosure>
  );
}

export function ShutDoors() {
  // `data-lock` presses this card into the page instead of raising it. Polarity is carried
  // by the material, so the two lists stop reading as the same card twice.
  return (
    <Disclosure
      lock
      title="What it will never be able to do"
      summary={`${SHUT_DOORS.length} things Mailwarden's servers refuse outright. The assistant cannot override them.`}
    >
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
    </Disclosure>
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

/**
 * A field, validated without a line of JavaScript.
 *
 * Validation is the browser's own: `type` plus `required` drive it, and `:user-invalid`
 * styles the result. `:user-invalid` rather than `:invalid` matters - `:invalid` marks an
 * untouched empty required field as wrong the moment the page paints, which is how a
 * consent screen greets a first-time visitor with two red boxes.
 *
 * `peek` adds the show-password eye. It needs the one inline script in `peek.ts`, because
 * the CSS-only route does not work: Chrome computes `-webkit-text-security: none` back to
 * `disc` on a real password input while `CSS.supports()` still reports true, so that
 * failure is silent and undetectable. The button ships `hidden` and the script reveals it,
 * so if the script is ever blocked there is no dead control - only a plain password field.
 */
export function Field(props: {
  name: string;
  label: string;
  hint?: string;
  type: string;
  autocomplete?: string;
  placeholder?: string;
  error?: string;
  peek?: boolean;
}) {
  return (
    <p class="field">
      <label for={props.name}>{props.label}</label>
      {props.hint && <span class="hint">{props.hint}</span>}
      <span class={props.peek ? "field-control field-control-peek" : "field-control"}>
        <input
          id={props.name}
          name={props.name}
          type={props.type}
          autocomplete={props.autocomplete || "off"}
          placeholder={props.placeholder}
          required
          spellcheck={false}
          autocapitalize="none"
          aria-describedby={`err_${props.name}`}
        />
        {props.peek && (
          <button
            type="button"
            class="peek"
            data-peek={props.name}
            aria-pressed="false"
            aria-label="Show password"
            hidden
          >
            <span class="peek-on">
              <Eye />
            </span>
            <span class="peek-off">
              <EyeOff />
            </span>
          </button>
        )}
        <span class="error" id={`err_${props.name}`}>
          <CircleAlert />
          {props.error}
        </span>
      </span>
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
