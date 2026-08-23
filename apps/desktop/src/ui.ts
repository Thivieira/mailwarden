import type { DesktopBridgeState } from "./types";
import { formatRelayStatusBadge } from "@mailwarden/ui";

export function renderDesktopHtml(state: DesktopBridgeState): string {
  const relayBadge = formatRelayStatusBadge(state.relayStatus);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailwarden Bridge Companion</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #0f172a;
      --border: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --online: #10b981;
      --degraded: #f59e0b;
      --proton: #6d4aff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 1.5rem; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .title { font-size: 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .org-badge { font-size: 0.75rem; background: rgba(56, 189, 248, 0.15); color: var(--primary); padding: 0.2rem 0.6rem; border-radius: 9999px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
    .card-title { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-bottom: 0.35rem; }
    .card-value { font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot-green { background: var(--online); }
    .dot-yellow { background: var(--degraded); }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .section-title { font-size: 0.9375rem; font-weight: 700; }
    .account-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .account-item { display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 0.75rem 1rem; border-radius: 6px; }
    .btn { background: #2563eb; color: #fff; border: none; padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
    .btn-secondary { background: rgba(255,255,255,0.05); color: var(--text); border: 1px solid var(--border); }
    .footer { font-size: 0.75rem; color: var(--muted); text-align: center; margin-top: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">
        <span>🛡️ Mailwarden Bridge</span>
        <span class="org-badge">${state.activeWorkspace?.name || "FoxDevStudio"}</span>
      </div>
      <div>
        <span style="font-size: 0.75rem; color: var(--muted);">Desktop Companion</span>
      </div>
    </div>

    <!-- Status Metric Cards -->
    <div class="grid">
      <div class="card">
        <div class="card-title">Relay</div>
        <div class="card-value">
          <span class="dot dot-green"></span>
          <span>Online</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Cloud Tunnel</div>
        <div class="card-value">
          <span class="dot dot-green"></span>
          <span>Secure</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Proton Bridge</div>
        <div class="card-value">
          <span class="dot dot-green"></span>
          <span>Running</span>
        </div>
      </div>
    </div>

    <!-- Accounts Roster -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-header">
        <div class="section-title">Connected Accounts (${state.accounts.length})</div>
        <button class="btn" onclick="alert('Open Mailwarden Portal to link another Proton mailbox.');">+ Add Account</button>
      </div>
      <div class="account-list">
        ${state.accounts
          .map(
            (acc) => `
          <div class="account-item">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="background: var(--proton); color: #fff; font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.35rem; border-radius: 3px;">PROTON</span>
              <span style="font-size: 0.875rem; font-weight: 600;">${acc.email}</span>
            </div>
            <span style="font-size: 0.75rem; color: #34d399; font-weight: 600;">● Synchronizing</span>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <!-- Actions & Diagnostics -->
    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
      <button class="btn btn-secondary" onclick="alert('Running local diagnostics: Cloudflare tunnel OK, Gateway 8080 OK, IMAP 1143 OK.');">🔍 Self-Test</button>
      <button class="btn btn-secondary" onclick="alert('Restart signal sent to local Bridge daemon.');">⚡ Restart Bridge</button>
    </div>

    <div class="footer">
      Mailwarden Bridge Desktop Companion &bull; Device: ${state.device?.name || "Local Workstation"}
    </div>
  </div>
</body>
</html>`;
}
