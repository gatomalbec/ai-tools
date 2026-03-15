import { stat } from "node:fs/promises";
import { readFile, appendFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_SESSION_ID,
  LOG_FILE,
  statePath,
  sessionPath,
} from "../constants.js";
import { ensureSessionDirs, shouldUseLegacyFallback } from "./session.js";
import type { LogEntry, LogLevel } from "../types.js";

const ENTRY_RE = /^\[(.+?)\] \[(\w+)\] (.+)$/;

function formatEntry(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level}] ${entry.text}`;
}

function parseEntry(line: string): LogEntry | null {
  const match = line.match(ENTRY_RE);
  if (!match) return null;
  return {
    timestamp: match[1],
    level: match[2] as LogLevel,
    text: match[3],
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readLogRaw(cwd: string, sessionId: string): Promise<string | null> {
  try {
    return await readFile(sessionPath(cwd, sessionId, LOG_FILE), "utf-8");
  } catch {
    if (!(await shouldUseLegacyFallback(cwd, sessionId))) {
      return null;
    }

    try {
      // Backward compatibility: legacy repo-global log location.
      return await readFile(statePath(cwd, LOG_FILE), "utf-8");
    } catch {
      return null;
    }
  }
}

export async function appendLog(cwd: string, level: LogLevel, text: string, sessionId = DEFAULT_SESSION_ID): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    text,
  };

  await ensureSessionDirs(cwd, sessionId);

  const logFile = sessionPath(cwd, sessionId, LOG_FILE);
  if (!(await fileExists(logFile))) {
    await writeFile(logFile, "# RLM Log\n\n", "utf-8");
  }

  await appendFile(logFile, formatEntry(entry) + "\n", "utf-8");
}

export async function readLogTail(
  cwd: string,
  count: number,
  levelFilter?: LogLevel,
  sessionId = DEFAULT_SESSION_ID,
): Promise<LogEntry[]> {
  const raw = await readLogRaw(cwd, sessionId);
  if (!raw) return [];

  const lines = raw.split("\n").filter((l) => l.trim() && !l.startsWith("# "));
  let entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
  }

  if (levelFilter) {
    entries = entries.filter((e) => e.level === levelFilter);
  }

  return entries.slice(-count);
}

export async function initLog(cwd: string, sessionId = DEFAULT_SESSION_ID): Promise<void> {
  await ensureSessionDirs(cwd, sessionId);
  const header = "# RLM Log\n\n";
  await writeFile(sessionPath(cwd, sessionId, LOG_FILE), header, "utf-8");
}
