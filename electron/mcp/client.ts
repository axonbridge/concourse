import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { shell } from "electron";
import log from "electron-log/main";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { UnauthorizedError, auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { clearOauth, hasTokens, readOauthValue, writeOauthValue } from "./token-store";

// The in-app MCP client (plan §M4): connects to the HTTP servers declared in a
// workspace's .mcp.json with OUR OWN OAuth (loopback flow, keychain tokens) —
// no dependency on the claude CLI's login. This is what lets EVERY engine
// (direct included) use the same integrations: add Atlassian once, it follows
// all providers. Connections are cached per server URL; tools are listed and
// called through the standard MCP protocol.

export type McpServerConfig = {
  type?: string;
  url?: string;
  /** stdio servers: local process command + args + env. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpServerStatus = {
  name: string;
  url: string;
  status: "connected" | "needs-auth" | "error" | "unsupported";
  toolCount?: number;
  error?: string;
  /** HTTP servers: whether OAuth tokens exist. Some servers list tools
   *  anonymously and only demand auth at call time — connected ≠ signed in. */
  authed?: boolean;
};

export type McpTool = {
  /** Namespaced id the engines expose to models: mcp__<server>__<tool>. */
  id: string;
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** Read a workspace's effective MCP config: the personal GLOBAL layer
 *  (userData/mcp.json — available in every project) merged with the
 *  workspace's own .mcp.json (the shareable contract; wins on collisions). */
export function readWorkspaceMcpConfig(cwd: string): Record<string, McpServerConfig> {
  let ws: Record<string, McpServerConfig> = {};
  try {
    const raw = fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
    if (parsed?.mcpServers && typeof parsed.mcpServers === "object") ws = parsed.mcpServers;
  } catch {
    /* no workspace file */
  }
  // Lazy import avoids a cycle (global-config imports the McpServerConfig type).
  const { readGlobalMcpConfig } = require("./global-config") as typeof import("./global-config");
  return { ...readGlobalMcpConfig(), ...ws };
}

// ── OAuth provider: SDK drives the flow; we store material + open the browser ─

const LOOPBACK_PORT_RANGE = { from: 42813, to: 42863 };

class KeychainOAuthProvider implements OAuthClientProvider {
  private redirect = "http://127.0.0.1:42813/callback"; // updated when the loopback binds

  constructor(private serverUrl: string) {}

  setRedirect(url: string) {
    this.redirect = url;
  }

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Concourse",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readOauthValue<OAuthClientInformationMixed>(this.serverUrl, "client");
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeOauthValue(this.serverUrl, "client", info);
  }

  tokens(): OAuthTokens | undefined {
    return readOauthValue<OAuthTokens>(this.serverUrl, "tokens");
  }

  saveTokens(tokens: OAuthTokens): void {
    writeOauthValue(this.serverUrl, "tokens", tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    void shell.openExternal(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    writeOauthValue(this.serverUrl, "verifier", codeVerifier);
  }

  codeVerifier(): string {
    const v = readOauthValue<string>(this.serverUrl, "verifier");
    if (!v) throw new Error("No PKCE verifier saved — restart the authentication.");
    return v;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    clearOauth(this.serverUrl, scope === "all" || scope === "client" ? "all" : "tokens");
  }
}

/** One-shot loopback server that captures the OAuth redirect's ?code=. */
function captureAuthCode(expectedPathHint: string): Promise<{
  redirectUrl: string;
  codePromise: Promise<string>;
  close: () => void;
}> {
  return new Promise((resolveSetup, rejectSetup) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (e: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<html><body style="font-family: system-ui; padding: 40px; text-align: center">
          <h2>${code ? "Connected." : "Authentication failed."}</h2>
          <p>You can close this tab and return to Concourse.</p>
        </body></html>`,
      );
      if (code) resolveCode(code);
      else rejectCode(new Error(err ?? "Authorization was denied."));
    });

    let port = LOOPBACK_PORT_RANGE.from;
    const tryListen = () => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && port < LOOPBACK_PORT_RANGE.to) {
          port += 1;
          tryListen();
        } else rejectSetup(e);
      });
      server.listen(port, "127.0.0.1", () => {
        resolveSetup({
          redirectUrl: `http://127.0.0.1:${port}${expectedPathHint}`,
          codePromise,
          close: () => server.close(),
        });
      });
    };
    tryListen();
  });
}

// ── Connection cache ─────────────────────────────────────────────────────────

type Connection = { client: Client; tools: McpTool[] };
const connections = new Map<string, Connection>(); // server url → live client

function toolId(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

async function openConnection(name: string, urlOrCfg: string | McpServerConfig): Promise<Connection> {
  const client = new Client({ name: "concourse", version: "1.0.0" });
  if (typeof urlOrCfg !== "string" && urlOrCfg.command) {
    // Local stdio server: spawn the declared process; no OAuth involved.
    const transport = new StdioClientTransport({
      command: urlOrCfg.command,
      args: urlOrCfg.args ?? [],
      env: { ...process.env, ...(urlOrCfg.env ?? {}) } as Record<string, string>,
    });
    await client.connect(transport);
  } else {
    const url = typeof urlOrCfg === "string" ? urlOrCfg : urlOrCfg.url!;
    const provider = new KeychainOAuthProvider(url);
    const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
    await client.connect(transport); // throws UnauthorizedError when auth is needed
  }
  const listed = await client.listTools();
  const tools: McpTool[] = (listed?.tools ?? []).map((t) => ({
    id: toolId(name, t.name),
    server: name,
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
  }));
  return { client, tools };
}

function cacheKey(name: string, cfg: McpServerConfig): string {
  return cfg.command ? `stdio:${name}:${cfg.command}` : (cfg.url ?? name);
}

/** Get (or open) the live connection for a server. Throws UnauthorizedError
 *  when the user needs to authenticate first (HTTP servers only). */
async function getConnection(name: string, cfg: McpServerConfig): Promise<Connection> {
  const key = cacheKey(name, cfg);
  const cached = connections.get(key);
  if (cached) return cached;
  const conn = await openConnection(name, cfg.command ? cfg : (cfg.url ?? ""));
  connections.set(key, conn);
  return conn;
}

function dropConnection(url: string): void {
  const conn = connections.get(url);
  connections.delete(url);
  void conn?.client.close().catch(() => {});
}

// ── Public surface (used by IPC + the direct engine) ─────────────────────────

/** Status of every server in a workspace's .mcp.json, connecting as needed. */
export async function workspaceServerStatus(cwd: string): Promise<McpServerStatus[]> {
  const config = readWorkspaceMcpConfig(cwd);
  const out: McpServerStatus[] = [];
  for (const [name, cfg] of Object.entries(config)) {
    const isStdio = !!cfg?.command;
    const url = cfg?.url ?? (isStdio ? `stdio: ${cfg.command}` : "");
    if (!isStdio && (!cfg?.url || (cfg.type && cfg.type !== "http" && cfg.type !== "sse" && cfg.type !== "stdio"))) {
      out.push({ name, url, status: "unsupported", error: "Unrecognized server type." });
      continue;
    }
    try {
      const conn = await getConnection(name, cfg);
      out.push({
        name,
        url,
        status: "connected",
        toolCount: conn.tools.length,
        authed: isStdio ? true : hasTokens(url),
      });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        // connect() already tried refresh; needs an interactive login.
        out.push({ name, url, status: "needs-auth" });
      } else {
        out.push({ name, url, status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}

/** Interactive OAuth: drives the flow EXPLICITLY (browser + loopback) instead
 *  of waiting for a 401 — some servers (Google's connector endpoints) accept
 *  anonymous connections and only reject at call time, so a connect-based
 *  probe never triggers sign-in. */
export async function authenticateServer(name: string, url: string): Promise<{ ok: boolean; error?: string }> {
  dropConnection(url);
  const loopback = await captureAuthCode("/callback");
  const provider = new KeychainOAuthProvider(url);
  provider.setRedirect(loopback.redirectUrl);
  try {
    // Discovery + (dynamic registration) + authorization. AUTHORIZED = valid
    // tokens already (or refresh worked); REDIRECT = browser opened via
    // provider.redirectToAuthorization — wait for the loopback code.
    const first = await auth(provider, { serverUrl: url });
    if (first === "REDIRECT") {
      const code = await Promise.race([
        loopback.codePromise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Timed out waiting for the browser login (3 min).")), 180_000),
        ),
      ]);
      const second = await auth(provider, { serverUrl: url, authorizationCode: code });
      if (second !== "AUTHORIZED") throw new Error("Authorization did not complete.");
    }
    // Reconnect with the fresh tokens on a clean transport.
    dropConnection(url);
    await getConnection(name, { url });
    return { ok: true };
  } catch (e) {
    log.error(`[mcp] auth failed for ${name}`, e);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /metadata|discovery|404|Not Found/i.test(msg)
        ? `This server doesn't support standard OAuth sign-in (${msg}). It may be locked to a specific client (e.g. claude.ai).`
        : msg,
    };
  } finally {
    loopback.close();
  }
}

export function logoutServer(url: string): void {
  dropConnection(url);
  clearOauth(url, "all");
}

/** All tools available to a workspace (flat, namespaced ids). Servers that are
 *  unauthenticated or erroring contribute nothing — engines stay usable. */
export async function workspaceTools(cwd: string): Promise<McpTool[]> {
  const config = readWorkspaceMcpConfig(cwd);
  const out: McpTool[] = [];
  for (const [name, cfg] of Object.entries(config)) {
    if (!cfg?.url && !cfg?.command) continue;
    try {
      const conn = await getConnection(name, cfg);
      out.push(...conn.tools);
    } catch {
      /* needs-auth or unreachable → skip; status surface reports it */
    }
  }
  return out;
}

/** Invoke a namespaced workspace tool. Returns the text content of the result. */
export async function callWorkspaceTool(
  cwd: string,
  id: string,
  args: Record<string, unknown>,
): Promise<string> {
  const m = id.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (!m) throw new Error(`Not an MCP tool id: ${id}`);
  const [, server, tool] = m;
  const config = readWorkspaceMcpConfig(cwd);
  const cfg = config[server!];
  if (!cfg?.url && !cfg?.command) throw new Error(`Server "${server}" is not in this workspace's .mcp.json.`);
  try {
    const conn = await getConnection(server!, cfg);
    const result = await conn.client.callTool({ name: tool!, arguments: args });
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .map((c: any) => (c?.type === "text" ? String(c.text ?? "") : JSON.stringify(c)))
      .join("\n");
    return result?.isError ? `Tool error: ${text || "unknown error"}` : text || "(empty result)";
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      dropConnection(cacheKey(server!, cfg));
      return `Error: the "${server}" integration needs to be re-authenticated (Settings → Integrations).`;
    }
    throw e;
  }
}
