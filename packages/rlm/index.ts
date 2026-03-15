import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { buildObservation, renderObservation } from "./src/observation.js";
import { registerTools } from "./src/tools.js";
import { initRlm, listSeeds } from "./src/init.js";
import { appendLog } from "./src/state/log.js";
import { statePath, LOOP_FILE, STATE_SUBDIR, DEFAULT_MAX_ITERATIONS } from "./src/constants.js";
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

async function readLoopState(cwd: string): Promise<LoopState | null> {
  try {
    const raw = await readFile(statePath(cwd, STATE_SUBDIR, LOOP_FILE), "utf-8");
    return JSON.parse(raw) as LoopState;
  } catch {
    return null;
  }
}

async function writeLoopState(cwd: string, state: LoopState): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(statePath(cwd, STATE_SUBDIR, LOOP_FILE), JSON.stringify(state, null, 2), "utf-8");
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

  pi.on("session_start", async (event, ctx) => {
    currentCwd = ctx.cwd;
  });

  pi.on("before_agent_start", async (event, ctx) => {
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

      // If no seed specified and multiple available, list them
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

      const result = await initRlm(ctx.cwd, { seed, force });

      if (ctx.hasUI) {
        ctx.ui.notify(result.message, result.created ? "info" : "warning");
      }

      if (result.created) {
        pi.sendUserMessage(
          `RLM initialized with seed "${result.seedUsed}". ` +
            `Read the strategy at .tdarlm/strategy.md and follow it.`,
        );
      }
    },
  });

  // --- Observation injection: default mode (before_agent_start) ---

  if (!liveObs) {
    pi.on("before_agent_start", async (_event, ctx) => {
      try {
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
      const loop = await readLoopState(ctx.cwd);
      if (!loop || !loop.enabled) return;

      if (loop.remaining <= 0) {
        await appendLog(ctx.cwd, "action", "Auto-continue exhausted — stopping.");
        loop.enabled = false;
        await writeLoopState(ctx.cwd, loop);
        return;
      }

      // Enforce hard ceiling
      if (loop.max > maxIterations) {
        loop.max = maxIterations;
      }

      // Decrement and continue
      loop.remaining = Math.max(0, loop.remaining - 1);
      await writeLoopState(ctx.cwd, loop);

      const iterationNum = loop.max - loop.remaining;
      await appendLog(
        ctx.cwd,
        "action",
        `Auto-continue iteration ${iterationNum}/${loop.max} (${loop.remaining} remaining)`,
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
