import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildObservation, renderObservation } from "./src/observation.js";
import { initRlm, listSeeds } from "./src/init.js";
import { resolveSessionId, ensureSessionDirs } from "./src/state/session.js";
import { isModeEnabled, readMode, setMode } from "./src/state/mode.js";
import { registerRecurseTool } from "./src/recurse.js";
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
const REQUIREMENTS_FILE = "requirements.json";

// --- Loop state helpers ---

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

// --- Requirements helpers ---

interface Requirement {
  id: string;
  statement: string;
  priority: string;
  status: string;
  source?: "user" | "agent";
}

interface RequirementsData {
  requirements: Requirement[];
}

async function readRequirements(cwd: string, sessionId: string): Promise<RequirementsData> {
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STATE_SUBDIR, REQUIREMENTS_FILE), "utf-8");
    const data = JSON.parse(raw);
    return { requirements: Array.isArray(data) ? data : data.requirements ?? [] };
  } catch {
    return { requirements: [] };
  }
}

async function writeRequirements(cwd: string, sessionId: string, data: RequirementsData): Promise<void> {
  await ensureSessionDirs(cwd, sessionId);
  const filePath = sessionPath(cwd, sessionId, STATE_SUBDIR, REQUIREMENTS_FILE);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function nextReqId(reqs: Requirement[]): string {
  let max = 0;
  for (const r of reqs) {
    const match = r.id.match(/^REQ-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `REQ-${String(max + 1).padStart(3, "0")}`;
}

async function isRequirementsBlocking(cwd: string, sessionId: string): Promise<{ blocking: boolean; criticalOpen: number }> {
  const data = await readRequirements(cwd, sessionId);
  const criticalOpen = data.requirements.filter((r) => r.priority === "critical" && r.status === "open").length;
  return { blocking: criticalOpen > 0, criticalOpen };
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
      `Auto-continue: ${loop?.enabled ? (loop.remaining === -1 ? `running (iteration ${loop.iteration ?? 0}, open-ended)` : `running (${loop.remaining} remaining)`) : "disabled"}`,
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

  // --- Register the recursive invocation tool ---

  registerRecurseTool(pi, exec, getCwd);

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

      if (result.created && ctx.hasUI) {
        const enabled = await isModeEnabled(ctx.cwd);
        if (!enabled) {
          ctx.ui.notify("RLM mode is currently OFF; run /rlm-on to activate it.", "warning");
        }
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
    description: "Show RLM mode status for this repository",
    handler: async (_args, ctx) => {
      const status = await buildStatusLines(ctx.cwd);
      if (ctx.hasUI) {
        ctx.ui.notify(status.lines.join("\n"), "info");
      }
      await refreshRlmUi(ctx);
    },
  });

  // --- /rlm-loop: control auto-continue ---

  pi.registerCommand("rlm-loop", {
    description: "Start/stop auto-continue. Usage: /rlm-loop [N] | /rlm-loop off | /rlm-loop status",
    handler: async (args, ctx) => {
      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const input = args?.trim() ?? "";

      // Show status
      if (input === "status") {
        const loop = await readLoopState(ctx.cwd, sessionId);
        if (!loop?.enabled) {
          if (ctx.hasUI) ctx.ui.notify("Auto-continue: disabled", "info");
        } else if (loop.remaining === -1) {
          if (ctx.hasUI) ctx.ui.notify(`Auto-continue: running (iteration ${loop.iteration}, open-ended, max ${maxIterations})`, "info");
        } else {
          if (ctx.hasUI) ctx.ui.notify(`Auto-continue: running (iteration ${loop.iteration}, ${loop.remaining} remaining)`, "info");
        }
        return;
      }

      // Disable
      if (input === "off") {
        await writeLoopState(ctx.cwd, sessionId, { enabled: false, remaining: 0, max: 0, iteration: 0 });
        if (ctx.hasUI) ctx.ui.notify("Auto-continue disabled.", "info");
        await refreshRlmUi(ctx);
        return;
      }

      // Enable: no args = open-ended, N = capped at N
      let remaining: number;
      let max: number;
      if (!input) {
        remaining = -1; // open-ended
        max = maxIterations;
        if (ctx.hasUI) ctx.ui.notify(`Auto-continue enabled (open-ended, hard cap ${maxIterations}). Agent can stop by writing loop.json with enabled:false.`, "info");
      } else {
        const n = parseInt(input, 10);
        if (isNaN(n) || n < 1) {
          if (ctx.hasUI) ctx.ui.notify("Usage: /rlm-loop [N] | /rlm-loop off | /rlm-loop status", "warning");
          return;
        }
        const capped = Math.min(n, maxIterations);
        remaining = capped;
        max = capped;
        if (ctx.hasUI) ctx.ui.notify(`Auto-continue enabled: ${capped} iterations.`, "info");
      }

      await writeLoopState(ctx.cwd, sessionId, { enabled: true, remaining, max, iteration: 0 });
      await refreshRlmUi(ctx);
    },
  });

  // --- /rlm-require: manage requirements gate ---

  pi.registerCommand("rlm-require", {
    description: "Manage requirements. Usage: /rlm-require <statement> | /rlm-require done <ID> | /rlm-require clear | /rlm-require",
    handler: async (args, ctx) => {
      const sessionId = await resolveSessionId(exec, ctx.cwd);
      const input = args?.trim() ?? "";

      // No args: list requirements
      if (!input) {
        const data = await readRequirements(ctx.cwd, sessionId);
        if (data.requirements.length === 0) {
          if (ctx.hasUI) ctx.ui.notify("No requirements defined.", "info");
          return;
        }
        const lines = data.requirements.map(
          (r) => `${r.id}: ${r.statement} (${r.priority}, ${r.status})`,
        );
        if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // Clear all
      if (input === "clear") {
        await writeRequirements(ctx.cwd, sessionId, { requirements: [] });
        if (ctx.hasUI) ctx.ui.notify("All requirements cleared.", "info");
        await refreshRlmUi(ctx);
        return;
      }

      // Mark done: /rlm-require done REQ-001
      const doneMatch = input.match(/^done\s+(REQ-\d+)$/i);
      if (doneMatch) {
        const id = doneMatch[1].toUpperCase();
        const data = await readRequirements(ctx.cwd, sessionId);
        const req = data.requirements.find((r) => r.id === id);
        if (!req) {
          if (ctx.hasUI) ctx.ui.notify(`Requirement ${id} not found.`, "warning");
          return;
        }
        req.status = "confirmed";
        await writeRequirements(ctx.cwd, sessionId, data);
        if (ctx.hasUI) ctx.ui.notify(`${id} marked as confirmed.`, "info");
        await refreshRlmUi(ctx);
        return;
      }

      // Add new requirement
      const data = await readRequirements(ctx.cwd, sessionId);
      const id = nextReqId(data.requirements);
      data.requirements.push({
        id,
        statement: input,
        priority: "critical",
        status: "open",
        source: "user",
      });
      await writeRequirements(ctx.cwd, sessionId, data);
      if (ctx.hasUI) ctx.ui.notify(`Added ${id}: ${input} (critical, open)`, "info");
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

      // For capped loops (remaining > 0), check if exhausted.
      if (loop.remaining !== -1 && loop.remaining <= 0) {
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);
        return;
      }

      // Hard ceiling: stop if iteration count exceeds max.
      if (loop.iteration >= maxIterations) {
        loop.enabled = false;
        await writeLoopState(ctx.cwd, sessionId, loop);
        pi.sendUserMessage(
          `Auto-continue hit hard ceiling (${maxIterations} iterations). Stopping.`,
          { deliverAs: "followUp" },
        );
        return;
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

      // Advance iteration counter, decrement remaining for capped loops.
      loop.iteration = (loop.iteration ?? 0) + 1;
      if (loop.remaining > 0) {
        loop.remaining = loop.remaining - 1;
      }
      await writeLoopState(ctx.cwd, sessionId, loop);

      pi.sendUserMessage(
        "Continue. Review the current strategy and state, then execute the next step. When you are done, write loop.json with enabled:false to stop.",
        { deliverAs: "followUp" },
      );
    } catch {
      // No .tdarlm or no loop.json — skip silently
    } finally {
      await refreshRlmUi(ctx);
    }
  });
}
