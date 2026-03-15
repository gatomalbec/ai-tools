import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeStateFile } from "../src/state/store.ts";
import { readRequirementsSummary } from "../src/state/requirements.ts";

async function makeTempRepo(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

test("requirements summary reports absent contract when no file exists", async () => {
  const cwd = await makeTempRepo("rlm-test-req-none-");
  const summary = await readRequirementsSummary(cwd, "ses_req");

  assert.equal(summary.present, false);
  assert.equal(summary.blocking, false);
  assert.equal(summary.total, 0);
});

test("requirements summary blocks when critical requirements are open", async () => {
  const cwd = await makeTempRepo("rlm-test-req-block-");

  await writeStateFile(
    cwd,
    "requirements.json",
    JSON.stringify(
      {
        requirements: [
          {
            id: "REQ-001",
            statement: "Must confirm API auth flow",
            priority: "critical",
            status: "open",
            verification: "integration test passes",
          },
          {
            id: "REQ-002",
            statement: "Add docs",
            priority: "low",
            status: "confirmed",
          },
        ],
        questions: [{ id: "Q-001", text: "OAuth or API key?", status: "open" }],
        assumptions: [{ id: "A-001", text: "API key for MVP", status: "active" }],
      },
      null,
      2,
    ),
    "ses_req",
  );

  const summary = await readRequirementsSummary(cwd, "ses_req");

  assert.equal(summary.present, true);
  assert.equal(summary.total, 2);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.open, 1);
  assert.equal(summary.criticalOpen, 1);
  assert.equal(summary.openQuestions, 1);
  assert.equal(summary.activeAssumptions, 1);
  assert.equal(summary.blocking, true);
});

test("requirements summary reports parse guidance for non-json contract files", async () => {
  const cwd = await makeTempRepo("rlm-test-req-md-");

  await writeStateFile(
    cwd,
    "requirements.md",
    "- REQ-001 critical open: clarify auth model",
    "ses_req",
  );

  const summary = await readRequirementsSummary(cwd, "ses_req");

  assert.equal(summary.present, true);
  assert.equal(summary.blocking, false);
  assert.ok(summary.parseError?.includes("Use requirements.json"));
});
