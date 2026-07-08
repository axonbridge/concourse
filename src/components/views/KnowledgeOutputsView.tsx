import { useEffect, useMemo, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { getElectron } from "~/lib/electron";
import { FileDatesBadge, MarkdownPreviewPanel, outputGroup } from "./ChatView";

// Project-level home for everything the AI has produced: deliverables
// (outputs/), workspace knowledge (facts + notes), and the shared org facts —
// Browse-Files-style: sectioned list on the left, click to view on the right,
// with a filename search filter. The in-chat Outputs panel stays session-
// scoped; this view is the full history.
export function KnowledgeOutputsView({
  cwd,
  onBack,
}: {
  cwd: string;
  onBack: () => void;
}) {
  const [orgDir, setOrgDir] = useState<string | null>(null);
  useEffect(() => {
    void getElectron()
      ?.getUserDataDir()
      .then((d) => setOrgDir(`${d}/org-knowledge`))
      .catch(() => {});
  }, []);

  const [files, setFiles] = useState<string[]>([]);
  const [mtimes, setMtimes] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const el = getElectron();
      const [ws, overlay, org] = await Promise.all([
        el?.files.list(cwd),
        el?.files.list(`${cwd}/.concourse`),
        orgDir ? el?.files.list(orgDir) : Promise.resolve(undefined),
      ]);
      if (cancelled) return;
      const wanted = (f: string) =>
        (f.startsWith("outputs/") ||
          f.startsWith("knowledge/facts/") ||
          f.startsWith("knowledge/notes/") ||
          f.startsWith("knowledge/projects/")) &&
        // No OS/hidden litter (.DS_Store and friends) in any path segment.
        !f.split("/").some((seg) => seg.startsWith("."));
      const a = ws?.ok ? ws.files.filter(wanted) : [];
      const b = overlay?.ok
        ? overlay.files.filter(wanted).map((f) => `.concourse/${f}`)
        : [];
      const c = org?.ok
        ? org.files
            .filter((f) => f.startsWith("facts/") && f.endsWith(".md"))
            .map((f) => `org-knowledge/${f}`)
        : [];
      const [wsStat, orgStat] = await Promise.all([
        a.length + b.length > 0 ? el?.files.stat(cwd, [...a, ...b]) : undefined,
        orgDir && c.length > 0
          ? el?.files.stat(orgDir, c.map((f) => f.slice("org-knowledge/".length)))
          : undefined,
      ]);
      if (cancelled) return;
      const mt: Record<string, number> = {};
      if (wsStat?.ok) Object.assign(mt, wsStat.mtimes);
      if (orgStat?.ok) {
        for (const [rel, m] of Object.entries(orgStat.mtimes)) {
          mt[`org-knowledge/${rel}`] = m;
        }
      }
      setFiles([...a, ...b, ...c]);
      setMtimes(mt);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cwd, orgDir, refreshKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
  }, [files, search]);

  const groups = useMemo(
    () =>
      [...new Set(visible.map(outputGroup))].sort(
        (a, b) =>
          Number(a.startsWith("knowledge")) - Number(b.startsWith("knowledge")) ||
          a.localeCompare(b),
      ),
    [visible],
  );

  const rootFor = (f: string) => (f.startsWith("org-knowledge/") && orgDir ? orgDir : cwd);
  const relFor = (f: string) =>
    f.startsWith("org-knowledge/") ? f.slice("org-knowledge/".length) : f;
  const labelFor = (f: string) =>
    f.replace(/^\.concourse\//, "").split("/").slice(2).join("/") || f;
  const isMd = (f: string) => /\.(md|markdown)$/i.test(f);

  const selectedValid = selected && visible.includes(selected) ? selected : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header: back · title · search · refresh */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <Btn variant="ghost" size="sm" icon="chevron-left" onClick={onBack}>
          Back
        </Btn>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Knowledge &amp; outputs</span>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative", width: 260 }}>
          <Icon
            name="search"
            size={12}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-faint)",
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files…"
            style={{
              width: "100%",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              padding: "6px 8px 6px 26px",
              borderRadius: 6,
              outline: "none",
            }}
          />
        </div>
        <Btn
          variant="ghost"
          icon="refresh"
          onClick={() => setRefreshKey((k) => k + 1)}
          aria-label="Refresh"
          style={{ width: 32, padding: 0 }}
        >
          {""}
        </Btn>
      </div>

      {/* Body: sectioned file list + preview pane */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: 340,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid var(--border)",
            padding: 8,
          }}
        >
          {visible.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-faint)", padding: 10 }}>
              {search
                ? "No files match the filter."
                : "Nothing yet — deliverables land in outputs/, learned facts and notes in knowledge/."}
            </div>
          )}
          {groups.map((group) => (
            <div key={group}>
              <div
                style={{
                  padding: "10px 8px 4px",
                  fontSize: 10.5,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--text-faint)",
                }}
              >
                {group}
              </div>
              {visible
                .filter((f) => outputGroup(f) === group)
                .sort((x, y) => (mtimes[y] ?? 0) - (mtimes[x] ?? 0))
                .map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      if (isMd(f)) setSelected(f);
                      // Non-markdown: reveal in Finder (user picks what opens it).
                      else void getElectron()?.revealPath(`${rootFor(f)}/${relFor(f)}`);
                    }}
                    title={f}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "none",
                      background: selectedValid === f ? "var(--surface-1)" : "transparent",
                      color: "var(--text)",
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    <Icon
                      name={isMd(f) ? "file" : "box"}
                      size={12}
                      style={{ color: "var(--text-faint)", flexShrink: 0 }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {labelFor(f)}
                    </span>
                    {mtimes[f] ? <FileDatesBadge updated={mtimes[f]} /> : null}
                  </button>
                ))}
            </div>
          ))}
        </div>

        {selectedValid ? (
          <MarkdownPreviewPanel
            key={selectedValid}
            cwd={rootFor(selectedValid)}
            relPath={relFor(selectedValid)}
            onClose={() => setSelected(null)}
            fill
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-faint)",
              fontSize: 13,
            }}
          >
            Select a file to preview — non-markdown files reveal in Finder.
          </div>
        )}
      </div>
    </div>
  );
}
