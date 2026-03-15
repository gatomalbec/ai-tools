import { mkdir } from "node:fs/promises";
import { DEFAULT_SESSION_ID, STATE_SUBDIR, sessionPath } from "../constants.js";
import type { ExecFn } from "../types.js";

function parseSessionFromJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { session?: unknown };
    return typeof parsed.session === "string" && parsed.session.trim().length > 0
      ? parsed.session
      : null;
  } catch {
    return null;
  }
}

/**
 * Normalize a td session id into a filesystem-safe name.
 */
export function sanitizeSessionId(sessionId: string | null | undefined): string {
  const value = (sessionId ?? "").trim();
  if (!value) return DEFAULT_SESSION_ID;

  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.length > 0 ? safe : DEFAULT_SESSION_ID;
}

async function readTdSession(exec: ExecFn, cwd: string, command: "status" | "usage"): Promise<string | null> {
  try {
    const result = await exec("td", [command, "--json"], cwd);
    if (result.exitCode !== 0) return null;
    return parseSessionFromJson(result.stdout);
  } catch {
    return null;
  }
}

/** Resolve active td session id, falling back to a local default. */
export async function resolveSessionId(exec: ExecFn, cwd: string): Promise<string> {
  const fromStatus = await readTdSession(exec, cwd, "status");
  if (fromStatus) return sanitizeSessionId(fromStatus);

  const fromUsage = await readTdSession(exec, cwd, "usage");
  if (fromUsage) return sanitizeSessionId(fromUsage);

  return DEFAULT_SESSION_ID;
}

/** Ensure the per-session directory skeleton exists. */
export async function ensureSessionDirs(cwd: string, sessionId: string): Promise<void> {
  await mkdir(sessionPath(cwd, sessionId, STATE_SUBDIR), { recursive: true });
}
