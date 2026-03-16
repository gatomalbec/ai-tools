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

## Phases

### Phase 0: Orient
Understand the problem before acting. Read relevant code, identify dependencies, build a mental model.

### Phase 1: Decompose
Break the problem into sub-tasks. For complex sub-tasks, use \`rlm_recurse\` to delegate to a fresh agent with isolated context. Each recursive call should be self-contained: include file paths, constraints, and decisions in the task description.

### Phase 2: Implement
Execute each sub-task. Prefer small, verifiable changes. After each change, verify it works.

### Phase 3: Verify
Check that all requirements are met. Run tests. Confirm the solution is complete.

## When to recurse
- The sub-problem needs significant exploration of unfamiliar code
- The sub-problem is self-contained and can be solved independently
- You need isolated context to avoid confusion with the parent task
- Do NOT recurse for trivial tasks you can handle directly

## Constraints
- Prefer small, verifiable changes
- When stuck, reflect and try a different approach
- Confirm critical assumptions before building on them
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
