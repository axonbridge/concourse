import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServerConfig } from "./client";

// Global (personal) MCP layer: servers available in EVERY project, stored in
// the app's data dir. Three-layer model mirroring knowledge: global config
// (personal, all projects) → workspace .mcp.json (the shareable contract,
// wins on name collisions) → tokens (always machine-level, never in files).

const FILE = () => path.join(app.getPath("userData"), "mcp.json");

export function readGlobalMcpConfig(): Record<string, McpServerConfig> {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), "utf8")) as {
      mcpServers?: Record<string, McpServerConfig>;
    };
    return parsed?.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  } catch {
    return {};
  }
}

export function writeGlobalMcpConfig(servers: Record<string, McpServerConfig>): void {
  fs.writeFileSync(FILE(), JSON.stringify({ mcpServers: servers }, null, 2) + "\n", "utf8");
}
