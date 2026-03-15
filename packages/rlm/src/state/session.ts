import { mkdir, readdir } from "node:fs/promises";
import { DEFAULT_SESSION_ID, STATE_SUBDIR, sessionPath, sessionsDir } from "../constants.js";
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
 * td session ids are expected to already be safe (e.g. ses_123abc),
 * but we sanitize defensively for forward-compatibility.
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

/**
 * Whether legacy repo-global state should be consulted.
 *
 * We only use legacy fallback when no session-scoped layout exists yet.
 * Once `.tdarlm/sessions/` contains at least one session directory,
 * reads are isolated to session scope.
 */
export async function shouldUseLegacyFallback(cwd: string, sessionId?: string): Promise<boolean> {
  try {
    const entries = await readdir(sessionsDir(cwd), { withFileTypes: true });
    const sessionDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    if (sessionDirs.length === 0) return true;

    // Bootstrap compatibility: if only the current session directory exists
    // (e.g., created by a first write before explicit /rlm-init), still allow
    // temporary fallback to legacy files for that same session.
    if (sessionId && sessionDirs.length === 1 && sessionDirs[0] === sessionId) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/** Ensure the per-session directory skeleton exists. */
export async function ensureSessionDirs(cwd: string, sessionId: string): Promise<void> {
  await mkdir(sessionPath(cwd, sessionId, STATE_SUBDIR), { recursive: true });
}
