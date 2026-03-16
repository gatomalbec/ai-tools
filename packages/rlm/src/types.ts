/** Auto-continue loop state. remaining=-1 means open-ended (agent decides when to stop). */
export interface LoopState {
  enabled: boolean;
  remaining: number;
  max: number;
  iteration: number;
}

/** The bounded observation injected into the system prompt */
export interface Observation {
  sessionId: string;
  depth: number;
  strategy: string;
  taskContext: string;
  stateFileIndex: string;
  requirementsSummary: string;
}

/** Shell exec helper signature */
export type ExecFn = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
