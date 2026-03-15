import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readMode, setMode, isModeEnabled } from "../src/state/mode.ts";

async function makeTempRepo(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

test("mode defaults to disabled when no mode.json exists", async () => {
  const cwd = await makeTempRepo("rlm-test-mode-default-");

  const mode = await readMode(cwd);
  assert.equal(mode.enabled, false);
  assert.equal(await isModeEnabled(cwd), false);
});

test("mode persists ON/OFF toggle in repo state", async () => {
  const cwd = await makeTempRepo("rlm-test-mode-toggle-");

  await setMode(cwd, true);
  assert.equal(await isModeEnabled(cwd), true);

  await setMode(cwd, false);
  assert.equal(await isModeEnabled(cwd), false);
});
