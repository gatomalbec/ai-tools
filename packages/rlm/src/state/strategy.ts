import { readFile, writeFile } from "node:fs/promises";
import { statePath, STRATEGY_FILE } from "../constants.js";
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

export async function readStrategy(cwd: string): Promise<Strategy | null> {
  try {
    const raw = await readFile(statePath(cwd, STRATEGY_FILE), "utf-8");
    return parseFrontMatter(raw);
  } catch {
    return null;
  }
}

export async function writeStrategy(
  cwd: string,
  content: string,
  meta: StrategyMeta,
): Promise<void> {
  await writeFile(statePath(cwd, STRATEGY_FILE), serializeFrontMatter(meta, content), "utf-8");
}

export async function updateStrategy(
  cwd: string,
  newContent: string,
): Promise<StrategyMeta> {
  const existing = await readStrategy(cwd);
  const meta: StrategyMeta = existing
    ? { ...existing.meta, revision: existing.meta.revision + 1 }
    : { seed: "unknown", initializedAt: new Date().toISOString(), revision: 1 };

  await writeStrategy(cwd, newContent, meta);
  return meta;
}
