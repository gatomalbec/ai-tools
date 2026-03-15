import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  stateDir,
  sessionPath,
  sessionsDir,
  SEEDS_DIR,
  GLOBAL_DIR,
  STATE_SUBDIR,
  STRATEGY_FILE,
  DEFAULT_SESSION_ID,
} from "./constants.js";
import { sanitizeSessionId } from "./state/session.js";

const DEFAULT_SEED = `# Default Strategy

## Approach
1. Understand the current task from td status
2. Break down into sub-steps if useful
3. Execute each step, logging progress
4. Verify results

## Constraints
- Prefer small, verifiable changes
- When stuck, reflect and revise approach
`;

export interface InitResult {
  created: boolean;
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

/**
 * Initialize .tdarlm state for a specific session.
 *
 * Creates per-session directory structure and copies seed strategy.
 */
export async function initRlm(
  cwd: string,
  options: { seed?: string; force?: boolean; sessionId?: string } = {},
): Promise<InitResult> {
  const sessionId = sanitizeSessionId(options.sessionId ?? DEFAULT_SESSION_ID);

  // Ensure directories exist.
  await mkdir(GLOBAL_DIR, { recursive: true });
  await mkdir(SEEDS_DIR, { recursive: true });
  await mkdir(stateDir(cwd), { recursive: true });
  await mkdir(sessionsDir(cwd), { recursive: true });
  await mkdir(sessionPath(cwd, sessionId, STATE_SUBDIR), { recursive: true });

  const strategyPath = sessionPath(cwd, sessionId, STRATEGY_FILE);
  if ((await pathExists(strategyPath)) && !options.force) {
    return {
      created: false,
      sessionId,
      seedUsed: "",
      message: `.tdarlm session "${sessionId}" already initialized. Use --force to reinitialize.`,
    };
  }

  // Resolve seed content.
  let seedContent: string;
  let seedName: string;

  if (options.seed) {
    const content = await readSeed(options.seed);
    if (!content) {
      return {
        created: false,
        sessionId,
        seedUsed: "",
        message: `Seed strategy "${options.seed}" not found in ${SEEDS_DIR}`,
      };
    }
    seedContent = content;
    seedName = options.seed;
  } else {
    const seeds = await listSeeds();
    if (seeds.length === 1) {
      seedContent = (await readSeed(seeds[0]))!;
      seedName = seeds[0];
    } else if (seeds.length > 1) {
      return {
        created: false,
        sessionId,
        seedUsed: "",
        message: `Multiple seeds available: ${seeds.join(", ")}. Use --seed <name> to choose.`,
      };
    } else {
      seedContent = DEFAULT_SEED;
      seedName = "default";
    }
  }

  await writeFile(strategyPath, seedContent, "utf-8");

  return {
    created: true,
    sessionId,
    seedUsed: seedName,
    message: `Initialized .tdarlm session "${sessionId}" with seed "${seedName}"`,
  };
}
