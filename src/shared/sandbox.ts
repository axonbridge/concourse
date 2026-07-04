// Scope vocabulary shared by the client, server, and Electron main.
// Historically a scope could point at a remote sandbox; today the only scope
// is the host machine. The scope_id columns on tasks/terminals remain (inert,
// always "local") so existing databases and query plumbing keep working.

/**
 * Sentinel scope meaning "the host machine" — the implicit, undeletable default.
 */
export const LOCAL_SCOPE_ID = "local";

export type ScopeId = string;

export function isLocalScope(scope: ScopeId | null | undefined): boolean {
  return !scope || scope === LOCAL_SCOPE_ID;
}

/** Every scope is the Local sentinel now that remote sandboxes are gone. */
export function normalizeScopeId(_scopeId?: string | null): string {
  return LOCAL_SCOPE_ID;
}
