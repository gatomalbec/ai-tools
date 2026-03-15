import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_SESSION_ID,
  STRATEGY_FILE,
  STATE_SUBDIR,
  statePath,
  sessionPath,
} from "../constants.js";
import { ensureSessionDirs, shouldUseLegacyFallback } from "./session.js";
import type { Strategy, StrategyMeta } from "../types.js";

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontMatter(raw: string): { meta: StrategyMeta; content: string } {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    return {
      meta: { seed: "unknown", initializedAt: new Date().toISOString(), revision: 0 },
      content: raw,
    };
  }

  const yamlBlock = match[1];
  const content = match[2].trim();

  // Simple YAML key-value parser (no dependency needed for flat front matter)
  const meta: Record<string, string> = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      meta[key] = val;
    }
  }

  return {
    meta: {
      seed: meta.seed ?? "unknown",
      initializedAt: meta.initializedAt ?? new Date().toISOString(),
      revision: parseInt(meta.revision ?? "0", 10),
    },
    content,
  };
}

function serializeFrontMatter(meta: StrategyMeta, content: string): string {
  return [
    "---",
    `seed: ${meta.seed}`,
    `initializedAt: ${meta.initializedAt}`,
    `revision: ${meta.revision}`,
    "---",
    "",
    content,
    "",
  ].join("\n");
}

export async function readStrategy(cwd: string, sessionId = DEFAULT_SESSION_ID): Promise<Strategy | null> {
  // Prefer session-scoped strategy.
  try {
    const raw = await readFile(sessionPath(cwd, sessionId, STRATEGY_FILE), "utf-8");
    return parseFrontMatter(raw);
  } catch {
    // Fallback to legacy repo-global strategy only before session layout exists.
    if (!(await shouldUseLegacyFallback(cwd, sessionId))) {
      return null;
    }

    try {
      const raw = await readFile(statePath(cwd, STRATEGY_FILE), "utf-8");
      return parseFrontMatter(raw);
    } catch {
      return null;
    }
  }
}

export async function writeStrategy(
  cwd: string,
  content: string,
  meta: StrategyMeta,
  sessionId = DEFAULT_SESSION_ID,
): Promise<void> {
  await ensureSessionDirs(cwd, sessionId);
  await writeFile(sessionPath(cwd, sessionId, STRATEGY_FILE), serializeFrontMatter(meta, content), "utf-8");
}

export async function updateStrategy(
  cwd: string,
  newContent: string,
  sessionId = DEFAULT_SESSION_ID,
): Promise<StrategyMeta> {
  const existing = await readStrategy(cwd, sessionId);
  const meta: StrategyMeta = existing
    ? { ...existing.meta, revision: existing.meta.revision + 1 }
    : { seed: "unknown", initializedAt: new Date().toISOString(), revision: 1 };

  // Snapshot the previous version before overwriting.
  if (existing) {
    const snapshotName = `strategy.v${existing.meta.revision}.md`;
    const snapshotPath = sessionPath(cwd, sessionId, STATE_SUBDIR, snapshotName);
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, serializeFrontMatter(existing.meta, existing.content), "utf-8");
  }

  await writeStrategy(cwd, newContent, meta, sessionId);
  return meta;
}
