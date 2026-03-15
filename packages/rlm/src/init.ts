import { mkdir, readFile, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { stateDir, statePath, SEEDS_DIR, GLOBAL_DIR, STATE_SUBDIR, STRATEGY_FILE } from "./constants.js";
import { writeStrategy } from "./state/strategy.js";
import { initLog, appendLog } from "./state/log.js";
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

export interface InitResult {
  created: boolean;
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

/**
 * Initialize .tdarlm/ in the given directory.
 *
 * 1. Creates directory structure
 * 2. Copies seed strategy (or uses default)
 * 3. Initializes log
 */
export async function initRlm(
  cwd: string,
  options: { seed?: string; force?: boolean } = {},
): Promise<InitResult> {
  const dir = stateDir(cwd);

  // Check existing
  try {
    const { stat } = await import("node:fs/promises");
    await stat(statePath(cwd, STRATEGY_FILE));
    if (!options.force) {
      return {
        created: false,
        seedUsed: "",
        message: `.tdarlm/ already exists. Use --force to reinitialize.`,
      };
    }
  } catch {
    // Does not exist, proceed
  }

  // Ensure global dir exists for future seeds
  await mkdir(GLOBAL_DIR, { recursive: true });
  await mkdir(SEEDS_DIR, { recursive: true });

  // Create local structure
  await mkdir(dir, { recursive: true });
  await mkdir(statePath(cwd, STATE_SUBDIR), { recursive: true });

  // Resolve seed
  let seedContent: string;
  let seedName: string;

  if (options.seed) {
    const content = await readSeed(options.seed);
    if (!content) {
      return {
        created: false,
        seedUsed: "",
        message: `Seed strategy "${options.seed}" not found in ${SEEDS_DIR}`,
      };
    }
    seedContent = content;
    seedName = options.seed;
  } else {
    // Try to find any seed
    const seeds = await listSeeds();
    if (seeds.length === 1) {
      seedContent = (await readSeed(seeds[0]))!;
      seedName = seeds[0];
    } else if (seeds.length > 1) {
      // Multiple seeds — caller should prompt user or pass --seed
      return {
        created: false,
        seedUsed: "",
        message: `Multiple seeds available: ${seeds.join(", ")}. Use --seed <name> to choose.`,
      };
    } else {
      seedContent = DEFAULT_SEED;
      seedName = "default";
    }
  }

  // Write strategy with front matter
  const meta: StrategyMeta = {
    seed: seedName,
    initializedAt: new Date().toISOString(),
    revision: 0,
  };
  await writeStrategy(cwd, seedContent, meta);

  // Initialize log
  await initLog(cwd);
  await appendLog(cwd, "action", `Initialized RLM with seed: ${seedName}`);

  return {
    created: true,
    seedUsed: seedName,
    message: `Initialized .tdarlm/ with seed "${seedName}"`,
  };
}
