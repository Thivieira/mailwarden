import type { DesktopBridgeState } from "./types";
import { formatRelayStatusBadge } from "@mailwarden/ui";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string
  );
}

function statusCard(title: string, value: string, tone: "green" | "yellow" | "red"): string {
  const color = tone === "green" ? "var(--online)" : tone === "yellow" ? "var(--degraded)" : "#f87171";
  return `<div class="card">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-value">
          <span class="dot" style="background: ${color};"></span>
          <span>${escapeHtml(value)}</span>
        </div>
      </div>`;
}

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
        <span class="org-badge">${escapeHtml(state.device?.name || state.deviceName || "Unpaired device")}</span>
      </div>
      <div>
        <span style="font-size: 0.75rem; color: var(--muted);">Desktop Companion</span>
      </div>
    </div>

    <!-- Status Metric Cards -->
    <div class="grid">
      ${statusCard("Relay", state.relayStatus === "online" ? "Online" : state.relayStatus.replace("_", " "), state.relayStatus === "online" ? "green" : state.relayStatus === "degraded" ? "yellow" : "red")}
      ${statusCard("Mailwarden Cloud", state.cloud.reachable ? "Connected" : state.cloud.configured ? "Unreachable" : "Not configured", state.cloud.reachable ? "green" : "red")}
      ${statusCard("Proton Bridge", state.protonBridge.status === "running" ? `Running (${state.protonBridge.imapPort})` : state.protonBridge.status === "stopped" ? "Stopped" : "Unknown", state.protonBridge.status === "running" ? "green" : "red")}
    </div>

    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-title">Status</div>
      <div style="font-size: 0.875rem; margin-top: 0.35rem;">${escapeHtml(state.message)}</div>
    </div>

    <!-- Accounts Roster -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="section-header">
        <div class="section-title">Accounts served by this relay (${state.accounts.length})</div>
      </div>
      <div class="account-list">
        ${state.accounts
          .map(
            (acc) => `
          <div class="account-item">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="background: var(--proton); color: #fff; font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.35rem; border-radius: 3px;">PROTON</span>
              <span style="font-size: 0.875rem; font-weight: 600;">${escapeHtml(acc.accountId)}</span>
            </div>
            <span style="font-size: 0.75rem; color: ${acc.status === "online" ? "#34d399" : acc.status === "error" ? "#f87171" : "#94a3b8"}; font-weight: 600;">
              ${acc.status === "online" ? `● Served ${escapeHtml(acc.lastSuccessAt || "")}` : acc.status === "error" ? "● Last request failed" : "● No traffic yet"}
            </span>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <!-- Actions & Diagnostics -->
    <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
      <button class="btn btn-secondary" onclick="runDiagnostics()">🔍 Self-Test</button>
      <button class="btn btn-secondary" onclick="runRepair('restart_gateway')">⚡ Restart gateway</button>
    </div>

    <div class="footer">
      Mailwarden Bridge Desktop Companion &bull; ${state.version ? escapeHtml(`v${state.version.version} (${state.version.platform})`) : "daemon not running"}
    </div>
    <pre id="output" style="white-space: pre-wrap; font-size: 0.75rem; color: var(--muted); margin-top: 1rem;"></pre>
  </div>
  <script>
    async function runDiagnostics() {
      var out = document.getElementById('output');
      out.textContent = 'Running diagnostics…';
      var res = await fetch('/api/diagnostics');
      var body = await res.json();
      out.textContent = body.diagnostics
        ? body.diagnostics.map(function (d) { return '[' + (d.status === 'pass' ? 'PASS' : 'FAIL') + '] ' + d.title + ': ' + d.explanation; }).join('\n')
        : 'The Mailwarden Bridge service is not running.';
    }
    async function runRepair(action) {
      var out = document.getElementById('output');
      out.textContent = 'Running ' + action + '…';
      var res = await fetch('/api/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action })
      });
      var body = await res.json();
      out.textContent = (body.applied ? 'Repaired: ' : 'Not repaired: ') + body.detail;
    }
  </script>
</body>
</html>`;
}
