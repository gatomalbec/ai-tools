import { readFile, readdir } from "node:fs/promises";
import { STRATEGY_FILE, STATE_SUBDIR, sessionPath } from "./constants.js";
import { resolveSessionId } from "./state/session.js";
import { getTaskContext } from "./state/task.js";
import { getRecursionDepth } from "./recurse.js";
import type { ExecFn, Observation } from "./types.js";

async function readStrategy(cwd: string, sessionId: string): Promise<string> {
  try {
    return await readFile(sessionPath(cwd, sessionId, STRATEGY_FILE), "utf-8");
  } catch {
    return "(no strategy initialized — run /rlm-init)";
  }
}

async function listStateFiles(cwd: string, sessionId: string): Promise<string[]> {
  try {
    const entries = await readdir(sessionPath(cwd, sessionId, STATE_SUBDIR));
    return entries.sort();
  } catch {
    return [];
  }
}

async function requirementsSection(cwd: string, sessionId: string): Promise<string> {
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STATE_SUBDIR, "requirements.json"), "utf-8");
    const data = JSON.parse(raw);
    const reqs: any[] = Array.isArray(data) ? data : data.requirements ?? [];
    if (reqs.length === 0) return "(none)";

    const open = reqs.filter((r) => r.status === "open").length;
    const confirmed = reqs.filter((r) => r.status === "confirmed").length;
    const criticalOpen = reqs.filter((r) => r.priority === "critical" && r.status === "open").length;
    const summary = `${reqs.length} total, ${confirmed} confirmed, ${open} open (${criticalOpen} critical)`;

    const lines = reqs.map((r) => {
      const src = r.source === "user" ? " (user-set, only user can resolve)" : "";
      return `- ${r.id}: ${r.statement} [${r.priority}, ${r.status}]${src}`;
    });
    return `${summary}\n${lines.join("\n")}`;
  } catch {
    return "(no requirements.json)";
  }
}

/**
 * Build a bounded observation from session state.
 * Each component is read in parallel.
 */
export async function buildObservation(cwd: string, exec: ExecFn): Promise<Observation> {
  const sessionId = await resolveSessionId(exec, cwd);

  const [strategy, taskContext, stateFiles, requirementsSummary] = await Promise.all([
    readStrategy(cwd, sessionId),
    getTaskContext(exec, cwd),
    listStateFiles(cwd, sessionId),
    requirementsSection(cwd, sessionId),
  ]);

  return {
    sessionId,
    depth: getRecursionDepth(),
    strategy,
    taskContext,
    stateFileIndex: stateFiles.length > 0 ? stateFiles.join(", ") : "(none)",
    requirementsSummary,
  };
}

/**
 * Render an observation into the markdown block injected into the system prompt.
 */
export function renderObservation(obs: Observation): string {
  const depthLine = obs.depth > 0 ? ` (recursive sub-agent, depth ${obs.depth})` : "";

  return `## RLM State Observation

### Session
${obs.sessionId}${depthLine}

### Recursion Depth
${obs.depth}

### Strategy
${obs.strategy}

### Task Context
${obs.taskContext}

### Requirements
${obs.requirementsSummary}

### State Files
${obs.stateFileIndex}`;
}
