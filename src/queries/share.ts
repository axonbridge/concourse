import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "~/lib/api";

export const shareKeys = {
  status: (projectId: string) => ["projects", projectId, "share"] as const,
};

/** Tunnel availability + active tunnels; polled while the dialog is open.
 *  `fast` tightens the poll (e.g. while a tool install is in flight). */
export function useShareStatus(
  projectId: string,
  opts: { enabled?: boolean; fast?: boolean } = {},
) {
  return useQuery({
    queryKey: shareKeys.status(projectId),
    queryFn: () => api.shareStatus(projectId),
    enabled: !!projectId && (opts.enabled ?? true),
    refetchInterval: opts.fast ? 4_000 : 20_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

function useInvalidateShare(projectId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: shareKeys.status(projectId) });
}

export function useShareStart(projectId: string) {
  const invalidate = useInvalidateShare(projectId);
  return useMutation({
    mutationFn: (body: {
      port: number;
      mode: "private" | "public";
      provider?: "tailscale-serve" | "tailscale-funnel" | "ngrok" | "cloudflared";
    }) => api.shareStart(projectId, body),
    onSettled: invalidate,
  });
}

export function useShareStop(projectId: string) {
  const invalidate = useInvalidateShare(projectId);
  return useMutation({
    mutationFn: (tunnelId: string) => api.shareStop(projectId, tunnelId),
    onSettled: invalidate,
  });
}
