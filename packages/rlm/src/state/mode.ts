import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { statePath } from "../constants.js";

const MODE_FILE = "mode.json";

export interface RlmMode {
  enabled: boolean;
  updatedAt: string;
}

function defaultMode(): RlmMode {
  return {
    enabled: false,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function readMode(cwd: string): Promise<RlmMode> {
  try {
    const raw = await readFile(statePath(cwd, MODE_FILE), "utf-8");
    const parsed = JSON.parse(raw) as { enabled?: unknown; updatedAt?: unknown };
    return {
      enabled: parsed.enabled === true,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : defaultMode().updatedAt,
    };
  } catch {
    return defaultMode();
  }
}

export async function setMode(cwd: string, enabled: boolean): Promise<RlmMode> {
  const mode: RlmMode = {
    enabled,
    updatedAt: new Date().toISOString(),
  };

  const file = statePath(cwd, MODE_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(mode, null, 2) + "\n", "utf-8");
  return mode;
}

export async function isModeEnabled(cwd: string): Promise<boolean> {
  const mode = await readMode(cwd);
  return mode.enabled;
}
