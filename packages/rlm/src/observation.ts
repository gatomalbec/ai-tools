import { OBS_LOG_TAIL } from "./constants.js";
import { readStrategy } from "./state/strategy.js";
import { readLogTail } from "./state/log.js";
import { getTaskContext } from "./state/task.js";
import { listStateFiles } from "./state/store.js";
import { resolveSessionId } from "./state/session.js";
import type { ExecFn, Observation } from "./types.js";

/**
 * Obs(X) → O
 *
 * Builds a bounded observation from the full external state.
 * Each component is read in parallel and bounded independently.
 *
 * Workspace awareness (files, git state) is handled natively by pi-agent
 * and is not included in the RLM observation.
 */
export async function buildObservation(cwd: string, exec: ExecFn): Promise<Observation> {
  const sessionId = await resolveSessionId(exec, cwd);

  const [strategy, taskContext, logEntries, stateFiles] =
    await Promise.all([
      readStrategy(cwd, sessionId),
      getTaskContext(exec, cwd),
      readLogTail(cwd, OBS_LOG_TAIL, undefined, sessionId),
      listStateFiles(cwd, sessionId),
    ]);

  return {
    sessionId,
    strategy: strategy?.content ?? "(no strategy initialized — run /rlm-init)",
    taskContext,
    recentLog:
      logEntries.length > 0
        ? logEntries.map((e) => `[${e.timestamp}] [${e.level}] ${e.text}`).join("\n")
        : "(no log entries)",
    stateFileIndex: stateFiles.length > 0 ? stateFiles.join(", ") : "(none)",
  };
}

/**
 * Render an observation into the markdown block injected into the system prompt.
 */
export function renderObservation(obs: Observation): string {
  return `## RLM State Observation

### Session
${obs.sessionId}

### Strategy
${obs.strategy}

### Task Context
${obs.taskContext}

### Recent Log (last ${OBS_LOG_TAIL})
${obs.recentLog}

### State Files
${obs.stateFileIndex}`;
}
