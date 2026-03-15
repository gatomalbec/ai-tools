import type { ExecFn } from "../types.js";
import { OBS_TASK_MAX_CHARS } from "../constants.js";

export async function queryTd(
  exec: ExecFn,
  cwd: string,
  command: "status" | "usage" | "query" | "show",
  args?: string,
): Promise<string> {
  const cmdArgs = [command, "--json"];
  if (args) {
    cmdArgs.push(...args.split(/\s+/));
  }

  try {
    const result = await exec("td", cmdArgs, cwd);
    if (result.exitCode !== 0) {
      return `(td error: ${result.stderr.trim() || `exit code ${result.exitCode}`})`;
    }
    return result.stdout.trim();
  } catch {
    return "(td not available)";
  }
}

export async function getTaskContext(exec: ExecFn, cwd: string): Promise<string> {
  const raw = await queryTd(exec, cwd, "usage");
  if (raw.startsWith("(")) return raw; // error message passthrough
  return raw.length > OBS_TASK_MAX_CHARS
    ? raw.slice(0, OBS_TASK_MAX_CHARS) + "\n... (truncated)"
    : raw;
}
