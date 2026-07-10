// Shared bits for listing workspace output/knowledge files (chat outputs
// panel, Outputs & knowledge view): grouping paths and the file-date badge.

// Compact file-date label: time-of-day for today's files, "Jul 8" otherwise.
function fmtFileDay(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The engine saves files atomically (write + swap into place), which resets
// the OS creation date on every save — so "created" is unknowable for
// AI-maintained files and we show only the last-updated date.
export function FileDatesBadge({ updated }: { updated?: number }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--text-faint)",
      }}
    >
      {fmtFileDay(updated)}
    </span>
  );
}

// Panel grouping: outputs/<command>/… groups by command; knowledge files group
// as "knowledge · facts" / "knowledge · notes"; org-wide facts (userData
// org-knowledge root, shared by every project) as "knowledge · org (shared)".
export function outputGroup(f: string): string {
  if (f.startsWith("org-knowledge/")) return "knowledge · org (shared)";
  const p = f.replace(/^\.concourse\//, "");
  if (p.startsWith("knowledge/")) return `knowledge · ${p.split("/")[1] ?? ""}`;
  if (p.startsWith("attachments/")) return "attachments";
  return p.split("/")[1] ?? "";
}
