import { ApiError } from "~/lib/api";
import { STATUS_DISPLAY_ORDER } from "~/shared/domain";
import type { TaskStatus } from "~/db/schema";
import type { WorktreeInfo } from "~/shared/worktrees";

export type DeleteWorktreeMode = "clean" | "stash" | "discard";
export type SessionView = "active" | "pinned" | "archived";
export const WORKTREE_DELETE_FILES_MAX_HEIGHT = 220;

export function apiErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as { error?: unknown; stderr?: unknown })
        : null;
    if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    if (typeof body?.stderr === "string" && body.stderr.trim()) return body.stderr.trim();
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return null;
}

export function gitUnavailableTitle(error: unknown): string {
  const message = apiErrorMessage(error);
  return message ? `Git unavailable: ${message}` : "Git unavailable";
}

export function worktreeChangeLabel(count: number | undefined): string {
  if (count === undefined) return "Checking changes";
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

export function deleteWorktreeOptionsForMode(mode: DeleteWorktreeMode): {
  force?: boolean;
  stashChanges?: boolean;
} {
  if (mode === "stash") return { stashChanges: true };
  if (mode === "discard") return { force: true };
  return {};
}

export function formatWorktreeChangeStatus(area: "staged" | "unstaged", status: string): string {
  const areaLabel = area === "staged" ? "Staged" : "Unstaged";
  return `${areaLabel} ${status.replace("-", " ")}`;
}

export const OPTIMISTIC_WORKTREE_ID_PREFIX = "wt-optimistic-";

export function isOptimisticWorktree(worktree: WorktreeInfo): boolean {
  return worktree.id.startsWith(OPTIMISTIC_WORKTREE_ID_PREFIX);
}

export function launchUrlPort(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return [];
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? [port] : [];
  } catch {
    return [];
  }
}

export function firstDisplayedTask<T extends { status: TaskStatus }>(tasks: T[]): T | undefined {
  for (const status of STATUS_DISPLAY_ORDER) {
    const task = tasks.find((t) => t.status === status);
    if (task) return task;
  }
  return undefined;
}
