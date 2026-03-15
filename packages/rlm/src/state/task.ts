import type { ExecFn } from "../types.js";

const TASK_MAX_CHARS = 2000;

export async function getTaskContext(exec: ExecFn, cwd: string): Promise<string> {
  try {
    const result = await exec("td", ["usage", "--json"], cwd);
    if (result.exitCode !== 0) {
      return `(td error: ${result.stderr.trim() || `exit code ${result.exitCode}`})`;
    }
    const raw = result.stdout.trim();
    return raw.length > TASK_MAX_CHARS
      ? raw.slice(0, TASK_MAX_CHARS) + "\n... (truncated)"
      : raw;
  } catch {
    return "(td not available)";
  }
}
