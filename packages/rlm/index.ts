import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { buildObservation, renderObservation } from "./src/observation.js";
import { initRlm, listSeeds } from "./src/init.js";
import { resolveSessionId, ensureSessionDirs } from "./src/state/session.js";
import { isModeEnabled, readMode, setMode } from "./src/state/mode.js";
import { sessionPath, STATE_SUBDIR, DEFAULT_MAX_ITERATIONS, STRATEGY_FILE } from "./src/constants.js";
import type { ExecFn, LoopState } from "./src/types.js";

/** Shell exec helper */
function createExec(): ExecFn {
  return (cmd, args, cwd) =>
    new Promise((resolve) => {
      execFile(cmd, args, { cwd, timeout: 15_000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0,
        });
      });
    });
}

const LOOP_FILE = "loop.json";

async function readLoopState(cwd: string, sessionId: string): Promise<LoopState | null> {
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STATE_SUBDIR, LOOP_FILE), "utf-8");
    return JSON.parse(raw) as LoopState;
  } catch {
    return null;
  }
}

async function writeLoopState(cwd: string, sessionId: string, state: LoopState): Promise<void> {
  await ensureSessionDirs(cwd, sessionId);
  await writeFile(
    sessionPath(cwd, sessionId, STATE_SUBDIR, LOOP_FILE),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

async function isRequirementsBlocking(cwd: string, sessionId: string): Promise<{ blocking: boolean; criticalOpen: number }> {
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STATE_SUBDIR, "requirements.json"), "utf-8");
    const data = JSON.parse(raw);
    const reqs: any[] = Array.isArray(data) ? data : data.requirements ?? [];
    const criticalOpen = reqs.filter((r) => r.priority === "critical" && r.status === "open").length;
    return { blocking: criticalOpen > 0, criticalOpen };
  } catch {
    return { blocking: false, criticalOpen: 0 };
  }
}

export default function rlmExtension(pi: ExtensionAPI) {
  const exec = createExec();
  let maxIterations = DEFAULT_MAX_ITERATIONS;
  const RLM_UI_KEY = "rlm";

  // --- CLI flags ---

  pi.registerFlag("rlm-max-iterations", {
    description: "Maximum auto-continue iterations",
    type: "string",
    default: String(DEFAULT_MAX_ITERATIONS),
  });

  const maxFlag = pi.getFlag("rlm-max-iterations");
  if (typeof maxFlag === "string") {
    const parsed = parseInt(maxFlag, 10);
    if (!isNaN(parsed) && parsed > 0) maxIterations = parsed;
  }

  // --- Helpers ---

  let currentCwd = process.cwd();
  const getCwd = () => currentCwd;

  async function buildStatusLines(cwd: string): Promise<{ enabled: boolean; lines: string[] }> {
    const sessionId = await resolveSessionId(exec, cwd);
    const mode = await readMode(cwd);
    const reqCheck = await isRequirementsBlocking(cwd, sessionId);
    const loop = await readLoopState(cwd, sessionId);

    let strategyInfo: string;
    try {
      await readFile(sessionPath(cwd, sessionId, STRATEGY_FILE), "utf-8");
      strategyInfo = "initialized";
    } catch {
      strategyInfo = "(not initialized)";
    }

    const lines = [
      `RLM mode: ${mode.enabled ? "ON" : "OFF"}`,
      `Session: ${sessionId}`,
      `Strategy: ${strategyInfo}`,
      `Requirements gate: ${reqCheck.blocking ? `BLOCKED (${reqCheck.criticalOpen} critical-open)` : "clear"}`,
      `Auto-continue: ${loop?.enabled ? `enabled (${loop.remaining}/${loop.max} remaining)` : "disabled"}`,
    ];

    return { enabled: mode.enabled, lines };
  }

  function clearRlmUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(RLM_UI_KEY, undefined);
    ctx.ui.setWidget(RLM_UI_KEY, undefined);
  }

  async function refreshRlmUi(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    try {
      const status = await buildStatusLines(ctx.cwd);
      if (!status.enabled) {
        clearRlmUi(ctx);
        return;
      }

      ctx.ui.setStatus(
        RLM_UI_KEY,
        `${status.lines[0]} · ${status.lines[1]} · ${status.lines[3]} · ${status.lines[4]}`,
      );
      ctx.ui.setWidget(RLM_UI_KEY, status.lines, { placement: "aboveEditor" });
    } catch {
      clearRlmUi(ctx);
    }
  }

  // --- Events ---

  pi.on("session_start", async (_event, ctx) => {
    currentCwd = ctx.cwd;

    try {
      const enabled = await isModeEnabled(ctx.cwd);
      if (ctx.hasUI) {
        ctx.ui.notify(
          enabled
            ? "RLM mode is ON for this repo (/rlm-off to disable)."
            : "RLM mode is OFF for this repo (/rlm-on to enable).",
          "info",
        );
      }
    } catch {
      // ignore
    }

    await refreshRlmUi(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    currentCwd = ctx.cwd;
    await refreshRlmUi(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    currentCwd = ctx.cwd;
    await refreshRlmUi(ctx);
  });

  // --- Commands ---

  pi.registerCommand("rlm-init", {
    description: "Initialize .tdarlm/ state directory with a seed strategy",
    handler: async (args, ctx) => {
      const parts = args?.trim().split(/\s+/) ?? [];
      const force = parts.includes("--force");
      let seed: string | undefined;

      const seedIdx = parts.indexOf("--seed");
      if (seedIdx >= 0 && parts[seedIdx + 1]) {
        seed = parts[seedIdx + 1];
      }

      if (!seed && !force) {
        const seeds = await listSeeds();
        if (seeds.length > 1) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Multiple seeds available: ${seeds.join(", ")}\nUse: /rlm-init --seed <name>`,
              "info",
            );
          }
          return;
        }
      }

      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const result = await initRlm(ctx.cwd, { seed, force, sessionId });

      if (ctx.hasUI) {
        ctx.ui.notify(result.message, result.created ? "info" : "warning");
      }

      if (result.created) {
        const enabled = await isModeEnabled(ctx.cwd);
        const modeHint = enabled ? "" : " RLM mode is currently OFF; run /rlm-on to activate it.";

        pi.sendUserMessage(
          `RLM initialized for session "${result.sessionId}" with seed "${result.seedUsed}". ` +
            `Read the strategy at .tdarlm/sessions/${result.sessionId}/strategy.md and follow it.` +
            modeHint,
        );
      }

      await refreshRlmUi(ctx);
    },
  });

  pi.registerCommand("rlm-on", {
    description: "Enable RLM mode for this repository",
    handler: async (_args, ctx) => {
      const mode = await setMode(ctx.cwd, true);

      if (ctx.hasUI) {
        ctx.ui.notify(`RLM mode enabled. Updated: ${mode.updatedAt}`, "info");
      }

      const sessionId = await resolveSessionId(exec, ctx.cwd);
      try {
        await readFile(sessionPath(ctx.cwd, sessionId, STRATEGY_FILE), "utf-8");
      } catch {
        pi.sendUserMessage("RLM mode is ON, but no strategy is initialized for this session. Run /rlm-init.");
      }

      await refreshRlmUi(ctx);
    },
  });

  pi.registerCommand("rlm-off", {
    description: "Disable RLM mode for this repository",
    handler: async (_args, ctx) => {
      const mode = await setMode(ctx.cwd, false);
      if (ctx.hasUI) {
        ctx.ui.notify(`RLM mode disabled. Updated: ${mode.updatedAt}`, "info");
      }
      await refreshRlmUi(ctx);
    },
  });

  pi.registerCommand("rlm-status", {
    description: "Show whether RLM mode is active for this repository",
    handler: async (_args, ctx) => {
      const status = await buildStatusLines(ctx.cwd);
      if (ctx.hasUI) {
        ctx.ui.notify(status.lines.join("\n"), "info");
      }
      await refreshRlmUi(ctx);
    },
  });

  // --- Observation injection ---

  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      if (!(await isModeEnabled(ctx.cwd))) {
        return {};
      }

      const obs = await buildObservation(ctx.cwd, exec);
      const rendered = renderObservation(obs);
      return { systemPrompt: rendered };
    } catch {
      return {};
    }
  });

  // --- Auto-continue with requirements gating ---

  pi.on("agent_end", async (_event, ctx) => {
    try {
      if (!(await isModeEnabled(ctx.cwd))) return;

      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const loop = await readLoopState(ctx.cwd, sessionId);
      if (!loop || !loop.enabled) return;

      if (loop.remaining <= 0) {
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);
        return;
      }

      // Enforce hard ceiling
      if (loop.max > maxIterations) {
        loop.max = maxIterations;
      }

      // Requirements gate: halt when critical requirements are unresolved.
      const reqCheck = await isRequirementsBlocking(ctx.cwd, sessionId);
      if (reqCheck.blocking) {
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);

        pi.sendUserMessage(
          `Auto-continue paused: ${reqCheck.criticalOpen} critical requirement(s) still open. Resolve them before continuing.`,
          { deliverAs: "followUp" },
        );
        return;
      }

      // Decrement and continue
      loop.remaining = Math.max(0, loop.remaining - 1);
      await writeLoopState(ctx.cwd, sessionId, loop);

      pi.sendUserMessage(
        "Continue. Review the current strategy and state, then execute the next step.",
        { deliverAs: "followUp" },
      );
    } catch {
      // No .tdarlm or no loop.json — skip silently
    } finally {
      await refreshRlmUi(ctx);
    }
  });
}
