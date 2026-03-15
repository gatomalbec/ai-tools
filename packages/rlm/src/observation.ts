import { OBS_LOG_TAIL } from "./constants.js";
import { readStrategy } from "./state/strategy.js";
import { readLogTail } from "./state/log.js";
import { getTaskContext } from "./state/task.js";
import { getGitSummary, getRecentFiles, formatWorkspaceSummary } from "./state/workspace.js";
import { listStateFiles } from "./state/store.js";
import type { ExecFn, Observation } from "./types.js";

/**
 * Obs(X) → O
 *
 * Builds a bounded observation from the full external state.
 * Each component is read in parallel and bounded independently.
 */
export async function buildObservation(cwd: string, exec: ExecFn): Promise<Observation> {
  const [strategy, taskContext, gitSummary, recentFiles, logEntries, stateFiles] =
    await Promise.all([
      readStrategy(cwd),
      getTaskContext(exec, cwd),
      getGitSummary(exec, cwd),
      getRecentFiles(exec, cwd),
      readLogTail(cwd, OBS_LOG_TAIL),
      listStateFiles(cwd),
    ]);

  return {
    strategy: strategy?.content ?? "(no strategy initialized — run /rlm-init)",
    taskContext,
    workspaceSummary: formatWorkspaceSummary(gitSummary, recentFiles),
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

### Strategy
${obs.strategy}

### Task Context
${obs.taskContext}

### Workspace
${obs.workspaceSummary}

### Recent Log (last ${OBS_LOG_TAIL})
${obs.recentLog}

### State Files
${obs.stateFileIndex}`;
}
