import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readStrategy, updateStrategy } from "./state/strategy.js";
import { appendLog, readLogTail } from "./state/log.js";
import { readStateFile, writeStateFile, deleteStateFile } from "./state/store.js";
import { resolveSessionId } from "./state/session.js";
import { queryTd } from "./state/task.js";
import { readRequirementsSummary, renderRequirementsSummary } from "./state/requirements.js";
import { LOG_READ_DEFAULT, LOG_READ_MAX } from "./constants.js";
import type { ExecFn, LogLevel } from "./types.js";

const LOG_LEVELS = ["observation", "action", "reflection", "error"] as const;
const TD_COMMANDS = ["status", "usage", "query", "show"] as const;

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export interface ToolOptions {
  fixedStrategy: boolean;
}

export function registerTools(pi: ExtensionAPI, exec: ExecFn, getCwd: () => string, opts: ToolOptions = { fixedStrategy: false }) {
  // --- Reading tools ---

  pi.registerTool({
    name: "rlm_read_strategy",
    label: "Read Strategy",
    description: "Read the current RLM reasoning strategy with metadata.",
    promptSnippet: "Read the mutable reasoning strategy for the active td session",
    parameters: Type.Object({}),
    async execute() {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const strategy = await readStrategy(cwd, sessionId);
      if (!strategy) return text("(no strategy initialized — run /rlm-init)");
      const header =
        `Session: ${sessionId}\n` +
        `Seed: ${strategy.meta.seed} | Revision: ${strategy.meta.revision} | Initialized: ${strategy.meta.initializedAt}\n\n`;
      return text(header + strategy.content);
    },
  });

  pi.registerTool({
    name: "rlm_read_log",
    label: "Read Log",
    description: "Read bounded RLM log entries with optional filtering by level.",
    promptSnippet: "Read log entries from the active session log (filtered, bounded)",
    parameters: Type.Object({
      count: Type.Optional(Type.Integer({ minimum: 1, maximum: LOG_READ_MAX, default: LOG_READ_DEFAULT, description: "Number of entries to return" })),
      level: Type.Optional(Type.Union(LOG_LEVELS.map((l) => Type.Literal(l)), { description: "Filter by log level" })),
    }),
    async execute(_toolCallId, params) {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const entries = await readLogTail(cwd, params.count ?? LOG_READ_DEFAULT, params.level as LogLevel | undefined, sessionId);
      if (entries.length === 0) return text("(no log entries)");
      return text(entries.map((e) => `[${e.timestamp}] [${e.level}] ${e.text}`).join("\n"));
    },
  });

  pi.registerTool({
    name: "rlm_read_state",
    label: "Read State File",
    description: "Read a named state file from the active session state store.",
    promptSnippet: "Read a named state file for structured intermediate data",
    parameters: Type.Object({
      name: Type.String({ description: "File name (e.g. dependency-graph.json)" }),
    }),
    async execute(_toolCallId, params) {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const content = await readStateFile(cwd, params.name, sessionId);
      if (content === null) return text(`State file "${params.name}" not found.`);
      return text(content);
    },
  });

  pi.registerTool({
    name: "rlm_task_query",
    label: "Task Query",
    description: "Query td task management system for current task state.",
    promptSnippet: "Query td for task status, usage context, or specific issues",
    parameters: Type.Object({
      command: Type.Union(TD_COMMANDS.map((c) => Type.Literal(c)), { description: "td command to run" }),
      args: Type.Optional(Type.String({ description: "Additional arguments (e.g. issue ID or TDQ query)" })),
    }),
    async execute(_toolCallId, params) {
      const result = await queryTd(exec, getCwd(), params.command as "status" | "usage" | "query" | "show", params.args);
      return text(result);
    },
  });

  pi.registerTool({
    name: "rlm_requirements_status",
    label: "Requirements Status",
    description: "Summarize requirements closure and requirement-gate blockers for the active session.",
    promptSnippet: "Read requirements contract status (open/assumed/confirmed, critical blockers)",
    parameters: Type.Object({}),
    async execute() {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const summary = await readRequirementsSummary(cwd, sessionId);
      return text(renderRequirementsSummary(summary));
    },
  });

  // --- Writing tools ---

  pi.registerTool({
    name: "rlm_update_strategy",
    label: "Update Strategy",
    description: "Update the mutable reasoning strategy. Requires a reason for the change.",
    promptSnippet: "Update active-session strategy.md (the mutable reasoning policy)",
    promptGuidelines: [
      "Only update strategy when you have a clear, specific reason.",
      "State the reason. Do not rewrite the entire strategy for minor changes.",
      "Strategy should stay concise — under 2000 characters ideally.",
    ],
    parameters: Type.Object({
      content: Type.String({ description: "New strategy content (full replacement)" }),
      reason: Type.String({ description: "Why the strategy is being updated" }),
    }),
    async execute(_toolCallId, params) {
      if (opts.fixedStrategy) {
        return text("Strategy is immutable (--rlm-fixed-strategy is set). Cannot update.");
      }

      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const meta = await updateStrategy(cwd, params.content, sessionId);
      await appendLog(cwd, "action", `Strategy updated (rev ${meta.revision}): ${params.reason}`, sessionId);
      return text(`Strategy updated to revision ${meta.revision}.`);
    },
  });

  pi.registerTool({
    name: "rlm_log",
    label: "Log Entry",
    description: "Append a timestamped entry to the RLM log.",
    promptSnippet: "Log an observation, action, reflection, or error to the active session log",
    promptGuidelines: [
      "Log observations about state, actions taken, reflections on approach, and errors.",
      "Keep entries concise (1-3 sentences).",
    ],
    parameters: Type.Object({
      level: Type.Union(LOG_LEVELS.map((l) => Type.Literal(l)), { description: "Log level" }),
      text: Type.String({ description: "Log message" }),
    }),
    async execute(_toolCallId, params) {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      await appendLog(cwd, params.level as LogLevel, params.text, sessionId);
      return text(`Logged [${params.level}] entry.`);
    },
  });

  pi.registerTool({
    name: "rlm_write_state",
    label: "Write State File",
    description: "Write a named state file to active session state for persistent intermediate data.",
    promptSnippet: "Write a named state file for structured data that survives context windows",
    promptGuidelines: [
      "Use state files for structured intermediate data: dependency graphs, parsed specs, decision logs.",
      "Do not duplicate strategy or log content in state files.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "File name (e.g. dependency-graph.json). Must end in .md/.json/.txt/.yaml/.yml" }),
      content: Type.String({ description: "File content" }),
    }),
    async execute(_toolCallId, params) {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      await writeStateFile(cwd, params.name, params.content, sessionId);
      return text(`State file "${params.name}" written.`);
    },
  });

  pi.registerTool({
    name: "rlm_delete_state",
    label: "Delete State File",
    description: "Delete a named state file from active session state.",
    promptSnippet: "Delete a named state file from the active session state store",
    parameters: Type.Object({
      name: Type.String({ description: "File name to delete" }),
    }),
    async execute(_toolCallId, params) {
      const cwd = getCwd();
      const sessionId = await resolveSessionId(exec, cwd);
      const deleted = await deleteStateFile(cwd, params.name, sessionId);
      return text(deleted ? `State file "${params.name}" deleted.` : `State file "${params.name}" not found.`);
    },
  });
}
