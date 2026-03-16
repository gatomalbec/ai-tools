/**
 * rlm_recurse — the recursive invocation primitive.
 *
 * Spawns an isolated `pi` subprocess with the current strategy as system prompt,
 * passes a sub-task, and returns the result. The child can itself recurse,
 * making this a true RLM.
 *
 * Adapted from pi-agent's subagent example (examples/extensions/subagent/).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { STRATEGY_FILE, sessionPath } from "./constants.js";
import { resolveSessionId } from "./state/session.js";
import type { ExecFn } from "./types.js";

const DEFAULT_MAX_DEPTH = 3;
const ENV_DEPTH_KEY = "RLM_DEPTH";

function currentDepth(): number {
  const raw = process.env[ENV_DEPTH_KEY];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

function writePromptToTempFile(content: string): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rlm-recurse-"));
  const filePath = path.join(tmpDir, "strategy.md");
  fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

interface Message {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) return part.text;
      }
    }
  }
  return "";
}

export function registerRecurseTool(
  pi: ExtensionAPI,
  exec: ExecFn,
  getCwd: () => string,
  opts: { maxDepth?: number } = {},
) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  pi.registerTool({
    name: "rlm_recurse",
    label: "RLM Recurse",
    description: [
      "Recursively invoke a fresh agent on a sub-problem with isolated context.",
      "The child agent receives the current strategy as its system prompt and has full tool access.",
      "Use this to decompose complex tasks: break into sub-problems, recurse on each, aggregate results.",
      `Current depth: ${currentDepth()}/${maxDepth}.`,
    ].join(" "),
    promptSnippet: "Spawn an isolated sub-agent on a scoped sub-task (recursive decomposition)",
    promptGuidelines: [
      "Use rlm_recurse when a sub-problem is too large or complex for the current context.",
      "Provide a clear, self-contained task description — the child has no memory of this conversation.",
      "Include relevant context (file paths, constraints, decisions) in the task description.",
      "Do NOT recurse for trivial tasks you can handle directly.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Self-contained description of the sub-task for the child agent" }),
      context: Type.Optional(
        Type.String({ description: "Additional context to prepend (e.g., relevant code, decisions made so far)" }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const depth = currentDepth();

      if (depth >= maxDepth) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Recursion depth limit reached (${depth}/${maxDepth}). Solve this sub-task directly instead of recursing.`,
            },
          ],
        };
      }

      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);

      // Read current strategy for injection into child.
      let strategyContent: string;
      try {
        strategyContent = fs.readFileSync(sessionPath(cwd, sessionId, STRATEGY_FILE), "utf-8");
      } catch {
        strategyContent = "";
      }

      // Build the system prompt: strategy + recursion context.
      const systemPrompt = [
        strategyContent,
        "",
        `## RLM Recursion Context`,
        `You are a recursive sub-agent at depth ${depth + 1}/${maxDepth}.`,
        `You have full tool access to explore and modify the codebase.`,
        depth + 1 >= maxDepth
          ? `You are at maximum recursion depth — do NOT call rlm_recurse. Solve the task directly.`
          : `You can call rlm_recurse to further decompose if needed.`,
        "",
        "When finished, provide a clear summary of what you did and any results.",
      ].join("\n");

      const { dir: tmpDir, filePath: tmpFile } = writePromptToTempFile(systemPrompt);

      // Build the user message.
      const userMessage = params.context
        ? `## Context\n${params.context}\n\n## Task\n${params.task}`
        : params.task;

      const args = ["--mode", "json", "-p", "--no-session", "--append-system-prompt", tmpFile, `Task: ${userMessage}`];

      const messages: Message[] = [];
      let stderr = "";

      try {
        const exitCode = await new Promise<number>((resolve) => {
          const proc = spawn("pi", args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              [ENV_DEPTH_KEY]: String(depth + 1),
            },
          });

          let buffer = "";

          const processLine = (line: string) => {
            if (!line.trim()) return;
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }

            if (event.type === "message_end" && event.message) {
              messages.push(event.message as Message);
            }
            if (event.type === "tool_result_end" && event.message) {
              messages.push(event.message as Message);
            }
          };

          proc.stdout.on("data", (data: any) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) processLine(line);
          });

          proc.stderr.on("data", (data: any) => {
            stderr += data.toString();
          });

          proc.on("close", (code: number | null) => {
            if (buffer.trim()) processLine(buffer);
            resolve(code ?? 0);
          });

          proc.on("error", () => {
            resolve(1);
          });

          if (signal) {
            const killProc = () => {
              proc.kill("SIGTERM");
              setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL");
              }, 5000);
            };
            if (signal.aborted) killProc();
            else signal.addEventListener("abort", killProc, { once: true });
          }
        });

        const output = getFinalOutput(messages);

        if (exitCode !== 0 && !output) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Recursive sub-agent failed (exit ${exitCode}): ${stderr.trim() || "(no output)"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: output || "(sub-agent produced no output)" }],
        };
      } finally {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          /* ignore */
        }
        try {
          fs.rmdirSync(tmpDir);
        } catch {
          /* ignore */
        }
      }
    },
  });
}

/** Get current recursion depth (for observation) */
export function getRecursionDepth(): number {
  return currentDepth();
}
