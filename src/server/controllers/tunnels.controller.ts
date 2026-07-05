import { z } from "zod";
import {
  TunnelError,
  listTunnels,
  startTunnel,
  stopTunnel,
  tunnelAvailability,
  tunnelErrorPayload,
} from "../services/tunnels";
import { handleDomainError, idParam, json, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

const startBody = z.object({
  port: z.number().int().min(1).max(65535),
  mode: z.enum(["private", "public"]),
  provider: z.enum(["tailscale-serve", "tailscale-funnel", "ngrok", "cloudflared"]).optional(),
});
const stopBody = z.object({ tunnelId: z.string().min(1) });

function asTunnelErrorResponse(e: unknown): Response {
  if (!(e instanceof TunnelError)) throw e;
  const payload = tunnelErrorPayload(e);
  return new Response(
    JSON.stringify({ error: payload.message, stderr: payload.stderr }),
    { status: HTTP_BAD_REQUEST, headers: { "content-type": "application/json" } },
  );
}

export async function status(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json({
      availability: await tunnelAvailability(),
      tunnels: listTunnels(parsed.data),
    });
  } catch (e) {
    return handleDomainError(e) ?? asTunnelErrorResponse(e);
  }
}

export async function start(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, startBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(await startTunnel(idParsed.data, parsed.data));
  } catch (e) {
    return handleDomainError(e) ?? asTunnelErrorResponse(e);
  }
}

export async function stop(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stopBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(await stopTunnel(parsed.data.tunnelId));
  } catch (e) {
    return handleDomainError(e) ?? asTunnelErrorResponse(e);
  }
}
