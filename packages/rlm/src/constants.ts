import path from "node:path";
import os from "node:os";

// Directory names
export const STATE_DIR = ".tdarlm";
export const SESSIONS_SUBDIR = "sessions";
export const STRATEGY_FILE = "strategy.md";
export const LOG_FILE = "log.md";
export const STATE_SUBDIR = "state";
export const LOOP_FILE = "loop.json";
export const DEFAULT_SESSION_ID = "default";

// Global seed location
export const GLOBAL_DIR = path.join(os.homedir(), ".tdarlm");
export const SEEDS_DIR = path.join(GLOBAL_DIR, "strategies");

// Observation bounds
export const OBS_LOG_TAIL = 20;
export const OBS_TASK_MAX_CHARS = 2000;
export const OBS_RECENT_FILES = 15;

// Tool limits
export const LOG_READ_DEFAULT = 50;
export const LOG_READ_MAX = 200;

// Auto-continue
export const DEFAULT_MAX_ITERATIONS = 10;

// State file name validation: alphanumeric, hyphens, dots, underscores
export const STATE_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(md|json|txt|yaml|yml)$/;

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
