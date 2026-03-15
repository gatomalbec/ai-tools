import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { statePath, STATE_SUBDIR, STATE_FILE_PATTERN } from "../constants.js";

function storeDir(cwd: string): string {
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

export async function readStateFile(cwd: string, name: string): Promise<string | null> {
  validateName(name);
  try {
    return await readFile(path.join(storeDir(cwd), name), "utf-8");
  } catch {
    return null;
  }
}

export async function writeStateFile(cwd: string, name: string, content: string): Promise<void> {
  validateName(name);
  const target = path.join(storeDir(cwd), name);
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

export async function deleteStateFile(cwd: string, name: string): Promise<boolean> {
  validateName(name);
  try {
    await unlink(path.join(storeDir(cwd), name));
    return true;
  } catch {
    return false;
  }
}

export async function listStateFiles(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(storeDir(cwd));
    return entries.filter((e) => STATE_FILE_PATTERN.test(e)).sort();
  } catch {
    return [];
  }
}
