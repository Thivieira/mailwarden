/**
 * systemd integration for the reference Linux server.
 *
 * One unit — `mailwarden-bridge` — supervises the gateway, the managed tunnel and
 * the heartbeat inside a single process, so an operator has one service to start,
 * stop, and read logs from. Proton Bridge stays its own unit because Proton owns
 * that lifecycle and its interactive login.
 *
 * Nothing here runs as root at runtime: the unit uses an unprivileged service
 * user, and every privileged step is printed before it is executed.
 */
export interface SystemdPlanOptions {
  /** Absolute path to the bun (or bridge) executable. */
  execPath: string;
  /** Absolute path to the daemon entrypoint passed to bun. */
  daemonPath?: string;
  user?: string;
  group?: string;
  stateDir?: string;
  configDir?: string;
  /** Order after the Proton Bridge unit when this host runs one. */
  protonUnit?: string;
}

export interface ServicePlan {
  unitName: string;
  unitPath: string;
  unitContents: string;
  /** Exact privileged commands, printed before anything is executed. */
  commands: string[];
}

export const BRIDGE_UNIT_NAME = "mailwarden-bridge.service";

export function planSystemdInstall(options: SystemdPlanOptions): ServicePlan {
  const user = options.user ?? "mailwarden";
  const group = options.group ?? user;
  const stateDir = options.stateDir ?? "/var/lib/mailwarden";
  const configDir = options.configDir ?? "/etc/mailwarden";
  const protonUnit = options.protonUnit ?? "proton-bridge.service";
  const exec = options.daemonPath ? `${options.execPath} run ${options.daemonPath}` : options.execPath;

  const unitContents = `[Unit]
Description=Mailwarden Bridge (Proton relay)
Documentation=https://github.com/tavtech/mailwarden/blob/main/docs/operations/ALMALINUX.md
# Ordered after Proton Bridge, but not Requires=: Bridge reports Proton as
# unhealthy rather than refusing to start, so the relay stays diagnosable.
After=network-online.target ${protonUnit}
Wants=network-online.target

[Service]
Type=simple
User=${user}
Group=${group}
Environment=HOME=${stateDir}
Environment=MAILWARDEN_BRIDGE_CONFIG_DIR=${configDir}
Environment=MAILWARDEN_BRIDGE_STATE_DIR=${stateDir}
ExecStart=${exec}
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM

# Hardening: the relay only needs loopback, its state directory, and outbound HTTPS.
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
RestrictSUIDSGID=true
RestrictRealtime=true
ReadWritePaths=${stateDir}
StateDirectory=mailwarden
UMask=0077

[Install]
WantedBy=multi-user.target
`;

  const unitPath = `/etc/systemd/system/${BRIDGE_UNIT_NAME}`;
  return {
    unitName: BRIDGE_UNIT_NAME,
    unitPath,
    unitContents,
    commands: [
      `install -d -o root -g root -m 0755 ${configDir}`,
      `install -d -o ${user} -g ${group} -m 0700 ${stateDir}`,
      `install -o root -g root -m 0644 <generated unit> ${unitPath}`,
      "systemctl daemon-reload",
      `systemctl enable --now ${BRIDGE_UNIT_NAME}`,
    ],
  };
}

export function planSystemdUninstall(): { commands: string[]; unitPath: string } {
  return {
    unitPath: `/etc/systemd/system/${BRIDGE_UNIT_NAME}`,
    commands: [
      `systemctl disable --now ${BRIDGE_UNIT_NAME}`,
      `rm -f /etc/systemd/system/${BRIDGE_UNIT_NAME}`,
      "systemctl daemon-reload",
      "# Device credentials and Proton Bridge data are left untouched on purpose.",
    ],
  };
}
