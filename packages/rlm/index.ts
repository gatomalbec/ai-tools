import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { buildObservation, renderObservation } from "./src/observation.js";
import { registerTools } from "./src/tools.js";
import { initRlm, listSeeds } from "./src/init.js";
import { appendLog } from "./src/state/log.js";
import { resolveSessionId, ensureSessionDirs, shouldUseLegacyFallback } from "./src/state/session.js";
import { readRequirementsSummary } from "./src/state/requirements.js";
import { isModeEnabled, readMode, setMode } from "./src/state/mode.js";
import { readStrategy } from "./src/state/strategy.js";
import { sessionPath, statePath, LOOP_FILE, STATE_SUBDIR, DEFAULT_MAX_ITERATIONS } from "./src/constants.js";
import type { ExecFn, LoopState } from "./src/types.js";

/** Shell exec helper — wraps execFile into the ExecFn signature */
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

async function readLoopState(cwd: string, sessionId: string): Promise<LoopState | null> {
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STATE_SUBDIR, LOOP_FILE), "utf-8");
    return JSON.parse(raw) as LoopState;
  } catch {
    if (!(await shouldUseLegacyFallback(cwd, sessionId))) {
      return null;
    }

    try {
      // Backward compatibility: legacy repo-global loop state.
      const raw = await readFile(statePath(cwd, STATE_SUBDIR, LOOP_FILE), "utf-8");
      return JSON.parse(raw) as LoopState;
    } catch {
      return null;
    }
  }
}

async function writeLoopState(cwd: string, sessionId: string, state: LoopState): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await ensureSessionDirs(cwd, sessionId);
  await writeFile(
    sessionPath(cwd, sessionId, STATE_SUBDIR, LOOP_FILE),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

export default function rlmExtension(pi: ExtensionAPI) {
  const exec = createExec();
  let liveObs = false;
  let maxIterations = DEFAULT_MAX_ITERATIONS;

  // --- CLI flags ---

  pi.registerFlag("rlm-live-obs", {
    description: "Refresh RLM observation before every LLM call (not just per user prompt)",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("rlm-max-iterations", {
    description: "Maximum auto-continue iterations",
    type: "string",
    default: String(DEFAULT_MAX_ITERATIONS),
  });

  pi.registerFlag("rlm-fixed-strategy", {
    description: "Strategy is immutable. Set to false to allow agent updates",
    type: "boolean",
    default: true,
  });

  // Read flags
  liveObs = pi.getFlag("rlm-live-obs") === true;
  const fixedStrategy = pi.getFlag("rlm-fixed-strategy") !== false;
  const maxFlag = pi.getFlag("rlm-max-iterations");
  if (typeof maxFlag === "string") {
    const parsed = parseInt(maxFlag, 10);
    if (!isNaN(parsed) && parsed > 0) maxIterations = parsed;
  }

  // --- Helper to get cwd ---

  let currentCwd = process.cwd();

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
      // ignore mode notification failures
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    currentCwd = ctx.cwd;
  });

  const getCwd = () => currentCwd;

  // --- Register tools ---

  registerTools(pi, exec, getCwd, { fixedStrategy });

  // --- Register /rlm-init command ---

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

      // If no seed specified and multiple available, list them.
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

        if (result.migrated) {
          pi.sendUserMessage(
            `RLM session "${result.sessionId}" initialized by migrating legacy state. ` +
              `Read the strategy at .tdarlm/sessions/${result.sessionId}/strategy.md and follow it.` +
              modeHint,
          );
        } else {
          pi.sendUserMessage(
            `RLM initialized for session "${result.sessionId}" with seed "${result.seedUsed}". ` +
              `Read the strategy at .tdarlm/sessions/${result.sessionId}/strategy.md and follow it.` +
              modeHint,
          );
        }
      }
    },
  });

  pi.registerCommand("rlm-on", {
    description: "Enable RLM mode for this repository",
    handler: async (_args, ctx) => {
      const mode = await setMode(ctx.cwd, true);
      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const strategy = await readStrategy(ctx.cwd, sessionId);

      if (ctx.hasUI) {
        ctx.ui.notify(`RLM mode enabled (repo). Updated: ${mode.updatedAt}`, "info");
      }

      if (!strategy) {
        pi.sendUserMessage("RLM mode is ON, but no strategy is initialized for this session. Run /rlm-init.");
      }
    },
  });

  pi.registerCommand("rlm-off", {
    description: "Disable RLM mode for this repository",
    handler: async (_args, ctx) => {
      const mode = await setMode(ctx.cwd, false);
      if (ctx.hasUI) {
        ctx.ui.notify(`RLM mode disabled (repo). Updated: ${mode.updatedAt}`, "info");
      }
    },
  });

  pi.registerCommand("rlm-status", {
    description: "Show whether RLM mode is active for this repository",
    handler: async (_args, ctx) => {
      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const mode = await readMode(ctx.cwd);
      const strategy = await readStrategy(ctx.cwd, sessionId);
      const reqSummary = await readRequirementsSummary(ctx.cwd, sessionId);
      const loop = await readLoopState(ctx.cwd, sessionId);

      const lines = [
        `RLM mode: ${mode.enabled ? "ON" : "OFF"} (repo-scoped)`,
        `Session: ${sessionId}`,
        `Strategy: ${strategy ? `seed=${strategy.meta.seed}, rev=${strategy.meta.revision}` : "(not initialized)"}`,
        `Observation mode: ${liveObs ? "live" : "before_agent_start"}`,
        `Strategy mutability: ${fixedStrategy ? "fixed" : "mutable"}`,
        `Requirements gate: ${reqSummary.blocking ? `BLOCKED (${reqSummary.criticalOpen} critical-open)` : "clear"}`,
        `Auto-continue: ${loop?.enabled ? `enabled (${loop.remaining}/${loop.max} remaining)` : "disabled"}`,
      ];

      if (ctx.hasUI) {
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  // --- Observation injection: default mode (before_agent_start) ---

  if (!liveObs) {
    pi.on("before_agent_start", async (_event, ctx) => {
      try {
        if (!(await isModeEnabled(ctx.cwd))) {
          return {};
        }

        const obs = await buildObservation(ctx.cwd, exec);
        const rendered = renderObservation(obs);
        return { systemPrompt: rendered };
      } catch {
        // .tdarlm not initialized — skip silently
        return {};
      }
    });
  }

  // --- Observation injection: live mode (context event) ---

  if (liveObs) {
    pi.on("context", async (_event, ctx) => {
      try {
        if (!(await isModeEnabled(ctx.cwd))) {
          return {};
        }

        const obs = await buildObservation(ctx.cwd, exec);
        const rendered = renderObservation(obs);

        // Inject as a system message at the end of the message array
        const messages = [..._event.messages];
        messages.push({
          role: "user",
          content: [{ type: "text", text: `<rlm-observation>\n${rendered}\n</rlm-observation>` }],
        } as any);

        return { messages };
      } catch {
        return {};
      }
    });
  }

  // --- Auto-continue (agent_end) ---

  pi.on("agent_end", async (_event, ctx) => {
    try {
      if (!(await isModeEnabled(ctx.cwd))) return;

      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const loop = await readLoopState(ctx.cwd, sessionId);
      if (!loop || !loop.enabled) return;

      if (loop.remaining <= 0) {
        await appendLog(ctx.cwd, "action", "Auto-continue exhausted — stopping.", sessionId);
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);
        return;
      }

      // Enforce hard ceiling
      if (loop.max > maxIterations) {
        loop.max = maxIterations;
      }

      // Requirements gate: stop autonomous iteration when critical
      // requirements are still open.
      const reqSummary = await readRequirementsSummary(ctx.cwd, sessionId);
      if (reqSummary.blocking) {
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);
        await appendLog(
          ctx.cwd,
          "reflection",
          `Auto-continue paused: ${reqSummary.criticalOpen} critical requirement(s) still open in ${reqSummary.sourceFile ?? "requirements.json"}.`,
          sessionId,
        );

        pi.sendUserMessage(
          "Auto-continue paused: unresolved critical requirements remain. Refine requirements with the user before continuing.",
          { deliverAs: "followUp" },
        );
        return;
      }

      // Decrement and continue
      loop.remaining = Math.max(0, loop.remaining - 1);
      await writeLoopState(ctx.cwd, sessionId, loop);

      const iterationNum = loop.max - loop.remaining;
      await appendLog(
        ctx.cwd,
        "action",
        `Auto-continue iteration ${iterationNum}/${loop.max} (${loop.remaining} remaining)`,
        sessionId,
      );

      pi.sendUserMessage(
        "Continue. Review the current strategy and state, then execute the next step.",
        { deliverAs: "followUp" },
      );
    } catch {
      // No .tdarlm or no loop.json — skip silently
    }
  });

  // --- Prompt guidelines (global) ---

  // These are provided via individual tool promptGuidelines, but we add
  // a global guideline via before_agent_start system prompt when not in live mode.
  // In live mode, they're part of the observation block.
}
