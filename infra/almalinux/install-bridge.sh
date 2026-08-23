#!/usr/bin/env bash
#
# Mailwarden Bridge installer for AlmaLinux / RHEL-compatible servers.
#
# It installs only the Mailwarden pieces: the service user, the directories, the
# systemd unit, and a starting config. It deliberately does NOT install Proton
# Mail Bridge or sign in to Proton — that needs an interactive login against a
# paid Proton account and a working keyring, and automating it today would mean
# guessing at interfaces Proton does not support for headless use.
#
# Every privileged command is printed before it runs.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/mailwarden}"
SERVICE_USER="${SERVICE_USER:-mailwarden}"
STATE_DIR="${STATE_DIR:-/var/lib/mailwarden}"
CONFIG_DIR="${CONFIG_DIR:-/etc/mailwarden}"
UNIT_NAME="mailwarden-bridge.service"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"

run() {
  echo "+ $*"
  "$@"
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "This installer must run as root (it creates a service user and a systemd unit)." >&2
    exit 1
  fi
}

uninstall() {
  require_root
  echo "Removing the Mailwarden Bridge service. Credentials in ${STATE_DIR} and any"
  echo "Proton Bridge installation are left untouched."
  run systemctl disable --now "${UNIT_NAME}" || true
  run rm -f "${UNIT_PATH}"
  run systemctl daemon-reload
  echo
  echo "Removed. To also erase this device's credentials: rm -rf ${STATE_DIR}"
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

require_root

BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [[ -z "${BUN_BIN}" ]]; then
  echo "bun was not found. Install Bun and re-run, or set BUN_BIN=/path/to/bun." >&2
  exit 1
fi
if [[ ! -f "${REPO_DIR}/apps/bridge/src/daemon.ts" ]]; then
  echo "Mailwarden was not found at ${REPO_DIR}. Set REPO_DIR to the checkout path." >&2
  exit 1
fi

echo "Installing Mailwarden Bridge"
echo "  repository:   ${REPO_DIR}"
echo "  bun:          ${BUN_BIN}"
echo "  service user: ${SERVICE_USER}"
echo "  state:        ${STATE_DIR}"
echo "  config:       ${CONFIG_DIR}"
echo

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  run useradd --system --home-dir "${STATE_DIR}" --create-home --shell /sbin/nologin "${SERVICE_USER}"
fi

run install -d -o root -g root -m 0755 "${CONFIG_DIR}"
run install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0700 "${STATE_DIR}"

if [[ ! -f "${CONFIG_DIR}/bridge.json" ]]; then
  # No secret belongs in this file; credentials live in the Bridge secret store.
  cat > "${CONFIG_DIR}/bridge.json" <<EOF
{
  "configVersion": 1,
  "deviceName": "$(hostname -s)",
  "cloudBaseUrl": "",
  "gateway": { "host": "127.0.0.1", "port": 8080 },
  "proton": { "imapHost": "127.0.0.1", "imapPort": 1143, "smtpHost": "127.0.0.1", "smtpPort": 1025 },
  "heartbeatSeconds": 60,
  "localApi": { "enabled": true, "port": 8765 },
  "logLevel": "info"
}
EOF
  run chmod 0644 "${CONFIG_DIR}/bridge.json"
  echo "Wrote ${CONFIG_DIR}/bridge.json — set cloudBaseUrl before registering."
fi

echo "+ writing ${UNIT_PATH}"
sed \
  -e "s#^ExecStart=.*#ExecStart=${BUN_BIN} run ${REPO_DIR}/apps/bridge/src/daemon.ts#" \
  -e "s#^User=.*#User=${SERVICE_USER}#" \
  -e "s#^Group=.*#Group=${SERVICE_USER}#" \
  "${REPO_DIR}/infra/systemd/${UNIT_NAME}" > "${UNIT_PATH}"
run chmod 0644 "${UNIT_PATH}"
run systemctl daemon-reload

echo
echo "Installed. Next steps:"
echo
echo "  1. Install official Proton Mail Bridge and sign in to each paid Proton account"
echo "     as ${SERVICE_USER} (this step is interactive and is not automated)."
echo "  2. Register this device:"
echo "       sudo -u ${SERVICE_USER} MAILWARDEN_BRIDGE_CONFIG_DIR=${CONFIG_DIR} \\"
echo "         MAILWARDEN_BRIDGE_STATE_DIR=${STATE_DIR} ${BUN_BIN} run ${REPO_DIR}/apps/bridge/src/cli.ts setup --cloud=https://<your-mailwarden-host>"
echo "  3. systemctl enable --now ${UNIT_NAME}"
echo "  4. sudo -u ${SERVICE_USER} ... cli.ts doctor    # explains anything still wrong"
