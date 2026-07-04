import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main";

// Keychain-encrypted storage for the in-app MCP client's OAuth material,
// keyed by server URL: dynamic client registration info, tokens, and the
// in-flight PKCE verifier. Same trust model as electron/credentials/store.ts —
// encrypted at rest via the OS keychain, never crosses IPC to the renderer.

const FILE = () => path.join(app.getPath("userData"), "mcp-oauth.json");

type Entry = {
  /** base64(safeStorage-encrypted JSON) blobs */
  client?: string;
  tokens?: string;
  verifier?: string;
};

type StoreShape = Record<string, Entry>; // server url → entry

function readStore(): StoreShape {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as StoreShape;
  } catch {
    /* missing/corrupt → empty */
  }
  return {};
}

function writeStore(store: StoreShape): void {
  fs.writeFileSync(FILE(), JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}

function encrypt(value: unknown): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.encryptString(JSON.stringify(value)).toString("base64");
  } catch (e) {
    log.error("[mcp-oauth] encrypt failed", e);
    return null;
  }
}

function decrypt<T>(blob: string | undefined): T | undefined {
  if (!blob || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(blob, "base64"))) as T;
  } catch {
    return undefined;
  }
}

export function readOauthValue<T>(serverUrl: string, field: keyof Entry): T | undefined {
  return decrypt<T>(readStore()[serverUrl]?.[field]);
}

export function writeOauthValue(serverUrl: string, field: keyof Entry, value: unknown): void {
  const blob = encrypt(value);
  if (!blob) return;
  const store = readStore();
  store[serverUrl] = { ...store[serverUrl], [field]: blob };
  writeStore(store);
}

export function clearOauth(serverUrl: string, scope: "all" | "tokens" = "all"): void {
  const store = readStore();
  if (!(serverUrl in store)) return;
  if (scope === "all") delete store[serverUrl];
  else {
    delete store[serverUrl]!.tokens;
    delete store[serverUrl]!.verifier;
  }
  writeStore(store);
}

export function hasTokens(serverUrl: string): boolean {
  return !!readStore()[serverUrl]?.tokens;
}
