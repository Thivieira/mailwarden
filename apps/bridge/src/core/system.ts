/**
 * Real OS adapters. Every module that touches the host takes these as an
 * argument, so tests substitute fakes instead of requiring cloudflared, Proton
 * Bridge, or open ports.
 */
import { connect } from "node:net";
import type { ProtonDiscoveryAdapters } from "@mailwarden/proton";

export interface SystemAdapters extends ProtonDiscoveryAdapters {}

export async function runCommand(
  command: string[],
  timeoutMs = 15_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [executable, ...args] = command;
  if (!executable) return { code: 127, stdout: "", stderr: "empty command" };
  try {
    const proc = Bun.spawn([executable, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

export function probeTcp(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export const systemAdapters: SystemAdapters = {
  async fileExists(path: string) {
    return await Bun.file(path).exists();
  },
  async which(command: string) {
    return Bun.which(command);
  },
  run: runCommand,
  probeTcp,
};
