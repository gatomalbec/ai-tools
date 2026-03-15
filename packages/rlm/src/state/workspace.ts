import type { ExecFn, GitSummary } from "../types.js";
import { OBS_RECENT_FILES } from "../constants.js";

export async function getGitSummary(exec: ExecFn, cwd: string): Promise<GitSummary | null> {
  try {
    const status = await exec("git", ["status", "--porcelain"], cwd);
    if (status.exitCode !== 0) return null;

    const lines = status.stdout.split("\n").filter(Boolean);
    let staged = 0, modified = 0, untracked = 0;
    for (const line of lines) {
      const idx = line[0];
      const wt = line[1];
      if (idx === "?" && wt === "?") untracked++;
      else if (idx !== " " && idx !== "?") staged++;
      if (wt !== " " && wt !== "?") modified++;
    }

    const branch = await exec("git", ["branch", "--show-current"], cwd);
    const branchName = branch.stdout.trim() || "detached";

    const log = await exec("git", ["log", "-1", "--oneline"], cwd);
    const lastCommit = log.exitCode === 0 ? log.stdout.trim() || null : null;

    return { branch: branchName, staged, modified, untracked, lastCommit };
  } catch {
    return null;
  }
}

export async function getRecentFiles(exec: ExecFn, cwd: string): Promise<string[]> {
  try {
    // Use git ls-files sorted by modification time via stat
    const result = await exec(
      "git",
      ["ls-files", "--modified", "--others", "--exclude-standard"],
      cwd,
    );
    if (result.exitCode !== 0) return [];

    const files = result.stdout.split("\n").filter(Boolean);
    return files.slice(0, OBS_RECENT_FILES);
  } catch {
    return [];
  }
}

export function formatWorkspaceSummary(git: GitSummary | null, recentFiles: string[]): string {
  if (!git) return "(not a git repository)";

  const parts = [
    `Branch: ${git.branch}, ${git.staged} staged, ${git.modified} modified, ${git.untracked} untracked`,
  ];
  if (git.lastCommit) parts.push(`Last commit: ${git.lastCommit}`);
  if (recentFiles.length > 0) parts.push(`Recent files: ${recentFiles.join(", ")}`);
  return parts.join("\n");
}
