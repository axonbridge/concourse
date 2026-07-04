// Git status/diff reads against the host repo (HTTP API). Only status + diff
// live here; mutations (stage/commit/push) stay on their own HTTP paths.
import { api } from "~/lib/api";
import type { GitStatus, GitDiff } from "~/shared/git-status";

export async function fetchGitStatus(
  projectId: string,
  worktreeId: string | null | undefined,
): Promise<GitStatus> {
  return api.getGitStatus(projectId, worktreeId);
}

export async function fetchGitDiff(
  projectId: string,
  file: string,
  staged: boolean,
  worktreeId: string | null | undefined,
): Promise<GitDiff> {
  return api.getGitDiff(projectId, file, staged, worktreeId);
}
