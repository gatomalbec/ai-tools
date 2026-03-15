import path from "node:path";
import os from "node:os";

// Directory names
export const STATE_DIR = ".tdarlm";
export const SESSIONS_SUBDIR = "sessions";
export const STRATEGY_FILE = "strategy.md";
export const STATE_SUBDIR = "state";
export const DEFAULT_SESSION_ID = "default";

// Global seed location
export const GLOBAL_DIR = path.join(os.homedir(), ".tdarlm");
export const SEEDS_DIR = path.join(GLOBAL_DIR, "strategies");

// Auto-continue
export const DEFAULT_MAX_ITERATIONS = 10;

/** Resolve the .tdarlm directory for a given repo root */
export function stateDir(cwd: string): string {
  return path.join(cwd, STATE_DIR);
}

/** Resolve a path within .tdarlm/ */
export function statePath(cwd: string, ...parts: string[]): string {
  return path.join(stateDir(cwd), ...parts);
}

/** Resolve .tdarlm/sessions/ */
export function sessionsDir(cwd: string): string {
  return statePath(cwd, SESSIONS_SUBDIR);
}

/** Resolve .tdarlm/sessions/<sessionId>/ */
export function sessionDir(cwd: string, sessionId: string): string {
  return statePath(cwd, SESSIONS_SUBDIR, sessionId);
}

/** Resolve a path within .tdarlm/sessions/<sessionId>/ */
export function sessionPath(cwd: string, sessionId: string, ...parts: string[]): string {
  return path.join(sessionDir(cwd, sessionId), ...parts);
}
