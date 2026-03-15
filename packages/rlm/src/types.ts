/** Strategy file metadata (YAML front matter) */
export interface StrategyMeta {
  seed: string;
  initializedAt: string;
  revision: number;
}

/** Parsed strategy file */
export interface Strategy {
  meta: StrategyMeta;
  content: string;
}

/** Log entry levels */
export type LogLevel = "observation" | "action" | "reflection" | "error";

/** Single log entry */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  text: string;
}

/** Git summary for workspace observation */
export interface GitSummary {
  branch: string;
  staged: number;
  modified: number;
  untracked: number;
  lastCommit: string | null;
}

/** Auto-continue loop state */
export interface LoopState {
  enabled: boolean;
  remaining: number;
  max: number;
}

/** The bounded observation O constructed from state X */
export interface Observation {
  sessionId: string;
  strategy: string;
  taskContext: string;
  workspaceSummary: string;
  recentLog: string;
  stateFileIndex: string;
}

/** Shell exec helper signature used throughout state readers */
export type ExecFn = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
