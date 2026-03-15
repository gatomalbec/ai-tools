import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";

type ShutdownAttempt = {
  command: string;
  args: string[];
};

const SHUTDOWN_ATTEMPTS: ShutdownAttempt[] = [
  { command: "/run/wrappers/bin/sudo", args: ["-n", "/run/current-system/sw/bin/poweroff"] },
  { command: "sudo", args: ["-n", "poweroff"] },
  { command: "/run/current-system/sw/bin/poweroff", args: [] },
  { command: "poweroff", args: [] },
  { command: "shutdown", args: ["-h", "now"] },
];

function launchDetached(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });

      child.once("error", () => resolve(false));
      child.unref();

      // If spawn succeeded and no immediate error is emitted, assume the
      // shutdown command was accepted.
      setTimeout(() => resolve(true), 150);
    } catch {
      resolve(false);
    }
  });
}

async function requestShutdown(): Promise<string | null> {
  for (const attempt of SHUTDOWN_ATTEMPTS) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await launchDetached(attempt.command, attempt.args);
    if (ok) {
      return [attempt.command, ...attempt.args].join(" ");
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  const handler = async (_args: string[] = [], ctx: any) => {
    if (process.env.PI_SAFE_VM !== "1") {
      if (ctx.hasUI) {
        ctx.ui.notify("/kill is only available inside a safe-pi VM session.", "error");
      }
      return;
    }

    if (ctx.hasUI) {
      ctx.ui.notify("Powering off VM now…", "warning");
    }

    const launched = await requestShutdown();
    if (!launched) {
      if (ctx.hasUI) {
        ctx.ui.notify("Failed to trigger VM shutdown. Try running `sudo poweroff` in /terminal.", "error");
      }
      return;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(`Shutdown requested via: ${launched}`, "info");
    }

    // Exit pi quickly after requesting shutdown so the command behaves as
    // "quit + kill" even if shutdown takes a second.
    setTimeout(() => {
      process.exit(0);
    }, 100);
  };

  pi.registerCommand("kill", {
    description: "Power off the safe-pi VM and exit pi",
    handler,
  });

  pi.registerCommand("kill-vm", {
    description: "Alias for /kill",
    handler,
  });
}
