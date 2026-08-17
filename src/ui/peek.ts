/**
 * The only JavaScript Mailwarden ships to a browser, and it exists for one reason: Chrome
 * refuses to unmask a password input from CSS. `-webkit-text-security: none` computes back
 * to `disc` on `type="password"`, while `CSS.supports()` still reports true, so the CSS-only
 * eye is not merely unsupported - it fails silently and undetectably. Verified Chrome 151,
 * 2026-08-17. Masking a `type="text"` field instead would expose the credential in cleartext
 * whenever the stylesheet fails to load, which is worse than having no eye at all.
 *
 * The page's CSP is `default-src 'none'` with no script permitted. This script is admitted
 * by a `sha256-` hash of these exact bytes, generated at build time by `build.ts` into
 * `peek.gen.ts`. Nothing else can execute: an injected `<script>` has a different hash and
 * is still refused, so the protection that matters on a credential page is intact. Only the
 * authorize page opts in; the send-approval page, which quotes untrusted email content,
 * keeps the no-script policy unchanged.
 *
 * Editing this string changes the hash. `bun run typecheck` regenerates it and
 * `tests/peek_script_csp.test.ts` fails if the two ever drift.
 *
 * The button ships with the `hidden` attribute and this script removes it, so a blocked or
 * failed script leaves no dead control on the page - the exact failure the CSS attempt had.
 */
export const PEEK_SCRIPT = `document.querySelectorAll("[data-peek]").forEach(function (b) {
  var i = document.getElementById(b.getAttribute("data-peek"));
  if (!i) return;
  b.hidden = false;
  b.addEventListener("click", function () {
    var show = i.type === "password";
    i.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", show ? "true" : "false");
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
});`;
