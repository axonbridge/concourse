import type { Project, TaskStatus } from "~/db/schema";

export type ProjectWithCounts = Project & {
  taskCounts: Record<TaskStatus, number> & { total: number; activeNonDone: number };
  preview?: string | null;
  githubUrl?: string | null;
};

export type ProjectPathStatus =
  | { ok: true; path: string; scope: "project" | "worktree"; worktreeId?: string | null }
  | {
      ok: false;
      path: string;
      scope: "project" | "worktree";
      worktreeId?: string | null;
      reason: "missing" | "not-directory" | "unreadable";
      message: string;
    };

/** A Claude Code slash command exposed by a project (from .claude/commands). */
export type ProjectCommand = {
  name: string;
  title: string;
  description: string;
  /** Best-effort example prompts parsed from the command file (may be empty). */
  examples: string[];
  /** True for user-created workflows (frontmatter `custom: true`) — only these
   *  can be deleted/shared/edited from the UI; seeded commands cannot. */
  custom: boolean;
  /** Optional emoji icon override (frontmatter `icon:`); falls back to a
   *  keyword-derived icon when absent. */
  icon?: string;
  /** Slug of the output template this workflow follows (frontmatter `template:`),
   *  resolving to `.claude/templates/‹slug›.md`. Absent = format defined inline. */
  template?: string;
};

/** Portable bundle for sharing a custom workflow (command + owned agents/skills
 *  + optional output template). */
export type CommandBundle = {
  version: 1;
  command: { name: string; content: string };
  agents: { name: string; content: string }[];
  skills: { name: string; content: string }[];
  template?: { name: string; content: string };
};

export type ProjectActivityState =
  | "offline"
  | "launch-running"
  | "agent-running"
  | "needs-input"
  | "interrupted";

export function getProjectActivity(
  project: ProjectWithCounts,
  launchRunningProjectIds: ReadonlySet<string>
): ProjectActivityState {
  if (project.taskCounts.interrupted > 0) return "interrupted";
  if (project.taskCounts["needs-input"] > 0) return "needs-input";
  if (project.taskCounts.running > 0) return "agent-running";
  if (launchRunningProjectIds.has(project.id)) return "launch-running";
  return "offline";
}

export function isProjectActive(activity: ProjectActivityState): boolean {
  return activity !== "offline";
}
