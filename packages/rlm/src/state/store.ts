import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SESSION_ID,
  STATE_SUBDIR,
  STATE_FILE_PATTERN,
  statePath,
  sessionPath,
} from "../constants.js";
import { ensureSessionDirs, shouldUseLegacyFallback } from "./session.js";

function storeDir(cwd: string, sessionId: string): string {
  return sessionPath(cwd, sessionId, STATE_SUBDIR);
}

function legacyStoreDir(cwd: string): string {
  return statePath(cwd, STATE_SUBDIR);
}

function validateName(name: string): void {
  if (!STATE_FILE_PATTERN.test(name)) {
    throw new Error(
      `Invalid state file name: "${name}". Must match pattern: alphanumeric start, ` +
        `alphanumeric/hyphens/dots/underscores, ending in .md/.json/.txt/.yaml/.yml`,
    );
  }
}

export async function readStateFile(cwd: string, name: string, sessionId = DEFAULT_SESSION_ID): Promise<string | null> {
  validateName(name);
  try {
    return await readFile(path.join(storeDir(cwd, sessionId), name), "utf-8");
  } catch {
    if (!(await shouldUseLegacyFallback(cwd, sessionId))) {
      return null;
    }

    try {
      // Backward compatibility: legacy repo-global store.
      return await readFile(path.join(legacyStoreDir(cwd), name), "utf-8");
    } catch {
      return null;
    }
  }
}

export async function writeStateFile(cwd: string, name: string, content: string, sessionId = DEFAULT_SESSION_ID): Promise<void> {
  validateName(name);
  await ensureSessionDirs(cwd, sessionId);
  await mkdir(storeDir(cwd, sessionId), { recursive: true });

  const target = path.join(storeDir(cwd, sessionId), name);
  // Atomic write: temp file + rename
  const tmp = path.join(tmpdir(), `rlm-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await writeFile(tmp, content, "utf-8");
  // rename is atomic on the same filesystem; fall back to direct write if cross-device
  try {
    const { rename } = await import("node:fs/promises");
    await rename(tmp, target);
  } catch {
    await writeFile(target, content, "utf-8");
    try { await unlink(tmp); } catch { /* ignore */ }
  }
}

export async function deleteStateFile(cwd: string, name: string, sessionId = DEFAULT_SESSION_ID): Promise<boolean> {
  validateName(name);

  const scopedPath = path.join(storeDir(cwd, sessionId), name);
  try {
    await unlink(scopedPath);
    return true;
  } catch {
    if (!(await shouldUseLegacyFallback(cwd, sessionId))) {
      return false;
    }

    // Backward compatibility: allow deleting legacy file if that's all that exists.
    try {
      await unlink(path.join(legacyStoreDir(cwd), name));
      return true;
    } catch {
      return false;
    }
  }
}

export async function listStateFiles(cwd: string, sessionId = DEFAULT_SESSION_ID): Promise<string[]> {
  const names = new Set<string>();

  try {
    const entries = await readdir(storeDir(cwd, sessionId));
    for (const entry of entries) {
      if (STATE_FILE_PATTERN.test(entry)) names.add(entry);
    }
  } catch {
    // ignore
  }

  if (await shouldUseLegacyFallback(cwd, sessionId)) {
    try {
      // Backward compatibility: include legacy files if present.
      const legacyEntries = await readdir(legacyStoreDir(cwd));
      for (const entry of legacyEntries) {
        if (STATE_FILE_PATTERN.test(entry)) names.add(entry);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(names).sort();
}
