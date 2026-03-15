import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveSessionId, shouldUseLegacyFallback } from "../src/state/session.ts";
import { initRlm } from "../src/init.ts";
import { readStrategy } from "../src/state/strategy.ts";
import { readStateFile } from "../src/state/store.ts";
import { appendLog, readLogTail } from "../src/state/log.ts";
import type { ExecFn } from "../src/types.ts";

async function makeTempRepo(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

function execStub(handler: (cmd: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number }): ExecFn {
  return async (cmd, args) => {
    const out = handler(cmd, args);
    return {
      stdout: out.stdout ?? "",
      stderr: out.stderr ?? "",
      exitCode: out.exitCode ?? 0,
    };
  };
}

test("resolveSessionId falls back to default when td is unavailable", async () => {
  const cwd = await makeTempRepo("rlm-test-session-");

  const exec: ExecFn = async () => {
    throw new Error("td missing");
  };

  const sessionId = await resolveSessionId(exec, cwd);
  assert.equal(sessionId, "default");
});

test("resolveSessionId prefers td status --json over usage --json", async () => {
  const cwd = await makeTempRepo("rlm-test-session-");
  const seen: Array<string> = [];

  const exec = execStub((cmd, args) => {
    seen.push(`${cmd} ${args.join(" ")}`);
    if (args[0] === "status") {
      return { stdout: JSON.stringify({ session: "ses_status" }) };
    }
    if (args[0] === "usage") {
      return { stdout: JSON.stringify({ session: "ses_usage" }) };
    }
    return { exitCode: 1, stderr: "unexpected" };
  });

  const sessionId = await resolveSessionId(exec, cwd);
  assert.equal(sessionId, "ses_status");
  assert.deepEqual(seen, ["td status --json"]);
});

test("/rlm-init migrates legacy repo-global state into active session", async () => {
  const cwd = await makeTempRepo("rlm-test-migrate-");

  await mkdir(path.join(cwd, ".tdarlm", "state"), { recursive: true });
  await writeFile(
    path.join(cwd, ".tdarlm", "strategy.md"),
    "---\nseed: legacy\ninitializedAt: 2026-01-01T00:00:00Z\nrevision: 0\n---\n\nlegacy strategy\n",
    "utf8",
  );
  await writeFile(
    path.join(cwd, ".tdarlm", "log.md"),
    "# RLM Log\n\n[2026-01-01T00:00:00Z] [action] legacy log\n",
    "utf8",
  );
  await writeFile(path.join(cwd, ".tdarlm", "state", "legacy.json"), '{"ok":true}', "utf8");

  const result = await initRlm(cwd, { sessionId: "ses_a" });
  assert.equal(result.created, true);
  assert.equal(result.migrated, true);
  assert.equal(result.sessionId, "ses_a");

  const strategy = await readStrategy(cwd, "ses_a");
  assert.equal(strategy?.content.trim(), "legacy strategy");

  const stateFile = await readStateFile(cwd, "legacy.json", "ses_a");
  assert.equal(stateFile, '{"ok":true}');

  const logs = await readLogTail(cwd, 20, undefined, "ses_a");
  assert.ok(logs.some((entry) => entry.text.includes("legacy log")));
  assert.ok(logs.some((entry) => entry.text.includes("Migrated legacy repo-global .tdarlm state")));
});

test("session isolation: other sessions do not read migrated legacy files", async () => {
  const cwd = await makeTempRepo("rlm-test-isolation-");

  await mkdir(path.join(cwd, ".tdarlm", "state"), { recursive: true });
  await writeFile(
    path.join(cwd, ".tdarlm", "strategy.md"),
    "---\nseed: legacy\ninitializedAt: 2026-01-01T00:00:00Z\nrevision: 0\n---\n\nlegacy strategy\n",
    "utf8",
  );
  await writeFile(path.join(cwd, ".tdarlm", "state", "legacy.json"), '{"ok":true}', "utf8");

  await initRlm(cwd, { sessionId: "ses_a" });

  assert.equal(await readStrategy(cwd, "ses_b"), null);
  assert.equal(await readStateFile(cwd, "legacy.json", "ses_b"), null);
  assert.deepEqual(await readLogTail(cwd, 10, undefined, "ses_b"), []);
});

test("bootstrap compatibility: same session can still see legacy fallback after first write", async () => {
  const cwd = await makeTempRepo("rlm-test-bootstrap-");

  await mkdir(path.join(cwd, ".tdarlm", "state"), { recursive: true });
  await writeFile(
    path.join(cwd, ".tdarlm", "strategy.md"),
    "---\nseed: legacy\ninitializedAt: 2026-01-01T00:00:00Z\nrevision: 0\n---\n\nlegacy strategy\n",
    "utf8",
  );

  assert.equal(await shouldUseLegacyFallback(cwd, "ses_a"), true);

  // This creates .tdarlm/sessions/ses_a but does not run /rlm-init.
  await appendLog(cwd, "action", "pre-init write", "ses_a");

  assert.equal(await shouldUseLegacyFallback(cwd, "ses_a"), true);
  assert.equal((await readStrategy(cwd, "ses_a"))?.content.trim(), "legacy strategy");

  assert.equal(await shouldUseLegacyFallback(cwd, "ses_b"), false);
  assert.equal(await readStrategy(cwd, "ses_b"), null);
});

test("/rlm-init creates requirements scaffold files", async () => {
  const cwd = await makeTempRepo("rlm-test-req-scaffold-");

  const result = await initRlm(cwd, { sessionId: "ses_req" });
  assert.equal(result.created, true);

  const reqRaw = await readStateFile(cwd, "requirements.json", "ses_req");
  assert.ok(reqRaw);

  const req = JSON.parse(reqRaw!);
  assert.ok(Array.isArray(req.requirements));
  assert.ok(Array.isArray(req.questions));
  assert.ok(Array.isArray(req.assumptions));

  const trace = await readStateFile(cwd, "traceability.md", "ses_req");
  assert.ok(trace?.includes("Requirement Traceability"));
});
