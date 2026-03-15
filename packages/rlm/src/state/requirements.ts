import { REQUIREMENTS_FILES } from "../constants.js";
import type { RequirementPriority, RequirementStatus, RequirementsSummary } from "../types.js";
import { listStateFiles, readStateFile } from "./store.js";

interface RequirementItem {
  id: string;
  statement: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  verification?: string;
}

interface ParsedContract {
  requirements: RequirementItem[];
  openQuestions: number;
  activeAssumptions: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePriority(value: unknown): RequirementPriority {
  const v = asText(value).toLowerCase();
  if (v === "critical" || v === "p0" || v === "blocker") return "critical";
  if (v === "high" || v === "p1") return "high";
  if (v === "low" || v === "p3") return "low";
  return "medium";
}

function normalizeStatus(value: unknown): RequirementStatus {
  const v = asText(value).toLowerCase();

  if (["confirmed", "accepted", "done", "implemented", "verified", "closed"].includes(v)) {
    return "confirmed";
  }

  if (["assumed", "assumption", "temporary", "provisional"].includes(v)) {
    return "assumed";
  }

  return "open";
}

function parseRequirementItem(item: unknown, index: number): RequirementItem {
  if (typeof item === "string") {
    return {
      id: `REQ-${String(index + 1).padStart(3, "0")}`,
      statement: item.trim(),
      priority: "medium",
      status: "open",
    };
  }

  if (!isRecord(item)) {
    return {
      id: `REQ-${String(index + 1).padStart(3, "0")}`,
      statement: "(invalid requirement item)",
      priority: "medium",
      status: "open",
    };
  }

  const id = asText(item.id) || `REQ-${String(index + 1).padStart(3, "0")}`;
  const statement = asText(item.statement) || asText(item.text) || "(missing statement)";
  const verification = asText(item.verification) || undefined;

  return {
    id,
    statement,
    priority: normalizePriority(item.priority),
    status: normalizeStatus(item.status),
    verification,
  };
}

function countOpenItems(items: unknown): number {
  if (!Array.isArray(items)) return 0;

  let count = 0;
  for (const item of items) {
    if (isRecord(item)) {
      const status = asText(item.status).toLowerCase();
      if (!status || status === "open" || status === "pending" || status === "unresolved") {
        count += 1;
      }
      continue;
    }

    // Strings in questions/assumptions are treated as unresolved/open.
    if (typeof item === "string" && item.trim().length > 0) {
      count += 1;
    }
  }

  return count;
}

function countActiveAssumptions(items: unknown): number {
  if (!Array.isArray(items)) return 0;

  let count = 0;
  for (const item of items) {
    if (isRecord(item)) {
      const status = asText(item.status).toLowerCase();
      if (!status || status === "active" || status === "assumed" || status === "open") {
        count += 1;
      }
      continue;
    }

    if (typeof item === "string" && item.trim().length > 0) {
      count += 1;
    }
  }

  return count;
}

function parseJsonContract(raw: string): ParsedContract {
  const parsed = JSON.parse(raw) as unknown;

  let requirementsRaw: unknown;
  let questionsRaw: unknown;
  let assumptionsRaw: unknown;

  if (Array.isArray(parsed)) {
    requirementsRaw = parsed;
  } else if (isRecord(parsed)) {
    requirementsRaw = parsed.requirements ?? parsed.items ?? [];
    questionsRaw = parsed.questions;
    assumptionsRaw = parsed.assumptions;
  } else {
    throw new Error("requirements.json must be an array or object");
  }

  if (!Array.isArray(requirementsRaw)) {
    throw new Error("requirements field must be an array");
  }

  const requirements = requirementsRaw.map(parseRequirementItem);

  return {
    requirements,
    openQuestions: countOpenItems(questionsRaw),
    activeAssumptions: countActiveAssumptions(assumptionsRaw),
  };
}

async function findRequirementsFile(cwd: string, sessionId: string): Promise<string | null> {
  const files = await listStateFiles(cwd, sessionId);
  for (const preferred of REQUIREMENTS_FILES) {
    if (files.includes(preferred)) return preferred;
  }
  return null;
}

export async function readRequirementsSummary(cwd: string, sessionId: string): Promise<RequirementsSummary> {
  const file = await findRequirementsFile(cwd, sessionId);
  if (!file) {
    return {
      present: false,
      total: 0,
      confirmed: 0,
      assumed: 0,
      open: 0,
      criticalOpen: 0,
      openQuestions: 0,
      activeAssumptions: 0,
      blocking: false,
    };
  }

  const raw = await readStateFile(cwd, file, sessionId);
  if (raw === null) {
    return {
      present: false,
      total: 0,
      confirmed: 0,
      assumed: 0,
      open: 0,
      criticalOpen: 0,
      openQuestions: 0,
      activeAssumptions: 0,
      blocking: false,
    };
  }

  if (!file.endsWith(".json")) {
    return {
      present: true,
      sourceFile: file,
      total: 0,
      confirmed: 0,
      assumed: 0,
      open: 0,
      criticalOpen: 0,
      openQuestions: 0,
      activeAssumptions: 0,
      blocking: false,
      parseError: `Unsupported format for gating: ${file}. Use requirements.json for machine-readable checks.`,
    };
  }

  try {
    const contract = parseJsonContract(raw);

    const total = contract.requirements.length;
    const confirmed = contract.requirements.filter((r) => r.status === "confirmed").length;
    const assumed = contract.requirements.filter((r) => r.status === "assumed").length;
    const open = contract.requirements.filter((r) => r.status === "open").length;
    const criticalOpen = contract.requirements.filter(
      (r) => r.priority === "critical" && r.status === "open",
    ).length;

    return {
      present: true,
      sourceFile: file,
      total,
      confirmed,
      assumed,
      open,
      criticalOpen,
      openQuestions: contract.openQuestions,
      activeAssumptions: contract.activeAssumptions,
      blocking: criticalOpen > 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    return {
      present: true,
      sourceFile: file,
      total: 0,
      confirmed: 0,
      assumed: 0,
      open: 0,
      criticalOpen: 0,
      openQuestions: 0,
      activeAssumptions: 0,
      blocking: false,
      parseError: `Failed to parse requirements contract: ${message}`,
    };
  }
}

export function renderRequirementsSummary(summary: RequirementsSummary): string {
  if (!summary.present) {
    return [
      "(no requirements contract found)",
      "Create state/requirements.json to track requirement closure and gating.",
    ].join("\n");
  }

  const lines = [
    `source: ${summary.sourceFile ?? "requirements.json"}`,
    `requirements: total=${summary.total}, confirmed=${summary.confirmed}, assumed=${summary.assumed}, open=${summary.open}`,
    `critical-open: ${summary.criticalOpen}`,
    `open-questions: ${summary.openQuestions}`,
    `active-assumptions: ${summary.activeAssumptions}`,
    `gate: ${summary.blocking ? "BLOCKED (resolve critical-open requirements)" : "clear"}`,
  ];

  if (summary.parseError) {
    lines.push(`parse: ${summary.parseError}`);
  }

  return lines.join("\n");
}
