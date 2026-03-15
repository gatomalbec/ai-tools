import { mkdir, readFile, writeFile, readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  stateDir,
  statePath,
  sessionPath,
  sessionsDir,
  SEEDS_DIR,
  GLOBAL_DIR,
  STATE_SUBDIR,
  STRATEGY_FILE,
  LOG_FILE,
  STATE_FILE_PATTERN,
  DEFAULT_SESSION_ID,
} from "./constants.js";
import { writeStrategy } from "./state/strategy.js";
import { initLog, appendLog } from "./state/log.js";
import { sanitizeSessionId } from "./state/session.js";
import type { StrategyMeta } from "./types.js";

const DEFAULT_SEED = `# Default Strategy

## Approach
1. Understand the current task from td status
2. Break down into sub-steps if useful
3. Execute each step, logging progress
4. Verify results
5. Update this strategy if the approach needs refinement

## Constraints
- Prefer small, verifiable changes
- Log decisions and their reasoning
- When stuck, reflect and revise strategy
`;

const DEFAULT_REQUIREMENTS_JSON = {
  requirements: [],
  questions: [],
  assumptions: [],
  settings: {
    assumptionBudget: 3,
    blockOnCriticalOpen: true,
  },
};

const DEFAULT_TRACEABILITY_MD = `# Requirement Traceability

Map each requirement to at least one task and one verification check.

| Requirement | Task(s) | Verification |
|---|---|---|
| REQ-001 | (task-id) | (command/test/assertion) |
`;

export interface InitResult {
  created: boolean;
  migrated: boolean;
  sessionId: string;
  seedUsed: string;
  message: string;
}

/** List available seed strategy names (file stems) */
export async function listSeeds(): Promise<string[]> {
  try {
    const entries = await readdir(SEEDS_DIR);
    return entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/** Read a seed strategy by name */
async function readSeed(name: string): Promise<string | null> {
  try {
    return await readFile(path.join(SEEDS_DIR, `${name}.md`), "utf-8");
  } catch {
    return null;
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function copyIfMissing(src: string, dst: string): Promise<boolean> {
  if (!(await pathExists(src)) || (await pathExists(dst))) return false;
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return true;
}

async function migrateLegacyState(cwd: string, sessionId: string): Promise<boolean> {
  let migrated = false;

  migrated = (await copyIfMissing(
    statePath(cwd, STRATEGY_FILE),
    sessionPath(cwd, sessionId, STRATEGY_FILE),
  )) || migrated;

  migrated = (await copyIfMissing(
    statePath(cwd, LOG_FILE),
    sessionPath(cwd, sessionId, LOG_FILE),
  )) || migrated;

  const legacyStateDir = statePath(cwd, STATE_SUBDIR);
  const sessionStateDir = sessionPath(cwd, sessionId, STATE_SUBDIR);

  try {
    const entries = await readdir(legacyStateDir);
    for (const entry of entries) {
      if (!STATE_FILE_PATTERN.test(entry)) continue;
      const copied = await copyIfMissing(
        path.join(legacyStateDir, entry),
        path.join(sessionStateDir, entry),
      );
      migrated = copied || migrated;
    }
  } catch {
    // Legacy state dir missing is normal.
  }

  return migrated;
}

async function ensureRequirementsScaffold(cwd: string, sessionId: string): Promise<void> {
  const reqPath = sessionPath(cwd, sessionId, STATE_SUBDIR, "requirements.json");
  if (!(await pathExists(reqPath))) {
    await mkdir(path.dirname(reqPath), { recursive: true });
    await writeFile(reqPath, JSON.stringify(DEFAULT_REQUIREMENTS_JSON, null, 2) + "\n", "utf-8");
  }

  const tracePath = sessionPath(cwd, sessionId, STATE_SUBDIR, "traceability.md");
  if (!(await pathExists(tracePath))) {
    await writeFile(tracePath, DEFAULT_TRACEABILITY_MD, "utf-8");
  }
}

/**
 * Initialize .tdarlm state for a specific session.
 *
 * 1. Creates per-session directory structure
 * 2. Migrates legacy repo-global state when possible
 * 3. Otherwise copies seed strategy (or uses default)
 * 4. Initializes per-session log
 */
export async function initRlm(
  cwd: string,
  options: { seed?: string; force?: boolean; sessionId?: string } = {},
): Promise<InitResult> {
  const sessionId = sanitizeSessionId(options.sessionId ?? DEFAULT_SESSION_ID);

  // Ensure global dir exists for future seeds.
  await mkdir(GLOBAL_DIR, { recursive: true });
  await mkdir(SEEDS_DIR, { recursive: true });

  // Ensure local structure exists.
  await mkdir(stateDir(cwd), { recursive: true });
  await mkdir(sessionsDir(cwd), { recursive: true });
  await mkdir(sessionPath(cwd, sessionId, STATE_SUBDIR), { recursive: true });

  const hasSessionStrategy = await pathExists(sessionPath(cwd, sessionId, STRATEGY_FILE));
  if (hasSessionStrategy && !options.force) {
    return {
      created: false,
      migrated: false,
      sessionId,
      seedUsed: "",
      message: `.tdarlm session "${sessionId}" already initialized. Use --force to reinitialize.`,
    };
  }

  // Migrate legacy state when initializing a new session without explicit seed/force.
  if (!hasSessionStrategy && !options.seed && !options.force) {
    const migrated = await migrateLegacyState(cwd, sessionId);
    if (migrated) {
      await ensureRequirementsScaffold(cwd, sessionId);
      await appendLog(
        cwd,
        "action",
        `Migrated legacy repo-global .tdarlm state into session: ${sessionId}`,
        sessionId,
      );

      return {
        created: true,
        migrated: true,
        sessionId,
        seedUsed: "legacy",
        message: `Migrated legacy .tdarlm state into session "${sessionId}" (requirements scaffold ensured).`,
      };
    }
  }

  // Resolve seed.
  let seedContent: string;
  let seedName: string;

  if (options.seed) {
    const content = await readSeed(options.seed);
    if (!content) {
      return {
        created: false,
        migrated: false,
        sessionId,
        seedUsed: "",
        message: `Seed strategy "${options.seed}" not found in ${SEEDS_DIR}`,
      };
    }
    seedContent = content;
    seedName = options.seed;
  } else {
    // Try to find any seed.
    const seeds = await listSeeds();
    if (seeds.length === 1) {
      seedContent = (await readSeed(seeds[0]))!;
      seedName = seeds[0];
    } else if (seeds.length > 1) {
      // Multiple seeds — caller should prompt user or pass --seed.
      return {
        created: false,
        migrated: false,
        sessionId,
        seedUsed: "",
        message: `Multiple seeds available: ${seeds.join(", ")}. Use --seed <name> to choose.`,
      };
    } else {
      seedContent = DEFAULT_SEED;
      seedName = "default";
    }
  }

  // Write strategy with front matter.
  const meta: StrategyMeta = {
    seed: seedName,
    initializedAt: new Date().toISOString(),
    revision: 0,
  };
  await writeStrategy(cwd, seedContent, meta, sessionId);

  // Initialize log and requirements scaffolding.
  await initLog(cwd, sessionId);
  await ensureRequirementsScaffold(cwd, sessionId);
  await appendLog(cwd, "action", `Initialized RLM with seed: ${seedName}`, sessionId);

  return {
    created: true,
    migrated: false,
    sessionId,
    seedUsed: seedName,
    message: `Initialized .tdarlm session "${sessionId}" with seed "${seedName}" (requirements scaffold created if missing)`,
  };
}
