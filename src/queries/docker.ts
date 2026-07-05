import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

export const dockerKeys = {
  status: (projectId: string, worktreeId?: string | null) =>
    ["projects", projectId, "worktrees", worktreeId || MAIN_WORKTREE_ID, "docker"] as const,
};

/** Compose stack status for the project header pill. Slow-polled: a docker
 *  CLI round-trip per tick is cheap but not free. */
export function useDockerStatus(
  projectId: string,
  worktreeId?: string | null,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: dockerKeys.status(projectId, worktreeId),
    queryFn: () => api.dockerStatus(projectId, worktreeId),
    enabled: !!projectId && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

function useInvalidateDocker(projectId: string, worktreeId?: string | null) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: dockerKeys.status(projectId, worktreeId) });
}

export function useDockerUp(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateDocker(projectId, worktreeId);
  return useMutation({
    mutationFn: () => api.dockerUp(projectId, worktreeId),
    onSettled: invalidate,
  });
}

export function useDockerStop(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateDocker(projectId, worktreeId);
  return useMutation({
    mutationFn: () => api.dockerStop(projectId, worktreeId),
    onSettled: invalidate,
  });
}

export function useDockerRestart(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateDocker(projectId, worktreeId);
  return useMutation({
    mutationFn: () => api.dockerRestart(projectId, worktreeId),
    onSettled: invalidate,
  });
}

export function useDockerEngineStart(projectId: string, worktreeId?: string | null) {
  const invalidate = useInvalidateDocker(projectId, worktreeId);
  return useMutation({
    mutationFn: () => api.dockerEngineStart(projectId),
    onSettled: invalidate,
  });
}
