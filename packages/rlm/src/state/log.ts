import { readFile, appendFile, writeFile } from "node:fs/promises";
import { statePath, LOG_FILE } from "../constants.js";
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

export async function appendLog(cwd: string, level: LogLevel, text: string): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    text,
  };
  await appendFile(statePath(cwd, LOG_FILE), formatEntry(entry) + "\n", "utf-8");
}

export async function readLogTail(
  cwd: string,
  count: number,
  levelFilter?: LogLevel,
): Promise<LogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(statePath(cwd, LOG_FILE), "utf-8");
  } catch {
    return [];
  }

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

export async function initLog(cwd: string): Promise<void> {
  const header = "# RLM Log\n\n";
  await writeFile(statePath(cwd, LOG_FILE), header, "utf-8");
}
