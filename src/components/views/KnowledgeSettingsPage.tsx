import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Markdown } from "~/components/ui/Markdown";
import { Modal } from "~/components/ui/Modal";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import {
  consumeCurationLogOpen,
  getLastCurationTaskId,
  ORG_CURATION_INTERVAL_MS,
  startOrgCuration,
} from "~/lib/org-curation";
import { queryKeys, useProjects, useSettings } from "~/queries";
import { useChatSession } from "~/lib/chat-store";
import { summarizeChatItem } from "~/lib/curation-log";

// Settings → Knowledge: the org brain made visible — every shared fact, the
// links between them as a graph (the graphify concept: markdown nodes, link
// edges), and the background curation job that keeps it clean without anyone
// remembering to.

type KnowledgeNode = {
  /** Unique across scopes (a slug can exist in two workspaces). */
  key: string;
  name: string;
  title: string;
  description: string;
  content: string;
  /** Org-shared vs a specific workspace's knowledge. */
  scope: "org" | "workspace";
  scopeLabel: string;
  /** Names of other knowledge files this one links to (graph edges). */
  links: string[];
};
type OrgFact = KnowledgeNode;

const INDEX_CLIFF = 100; // factIndexLines cap — the documented graphify trigger

function parseFact(
  name: string,
  content: string,
  allNames: Set<string>,
  scope: "org" | "workspace",
  scopeLabel: string,
): KnowledgeNode {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
  const title = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? name;
  const description = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? "";
  const links = new Set<string>();
  for (const m of content.matchAll(/\]\(<?([\w./-]+?\.md)>?\)/g)) {
    const target = m[1]!.split("/").pop()!.replace(/\.md$/, "");
    if (target !== name && allNames.has(target)) links.add(target);
  }
  for (const m of content.matchAll(/\[\[([\w-]+)\]\]/g)) {
    if (m[1] !== name && allNames.has(m[1]!)) links.add(m[1]!);
  }
  return { key: `${scopeLabel}:${name}`, name, title, description, content, scope, scopeLabel, links: [...links] };
}

export function KnowledgeSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { data: projects } = useProjects();
  const [facts, setFacts] = useState<OrgFact[]>([]);
  const [preview, setPreview] = useState<OrgFact | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [curating, setCurating] = useState(false);
  const [curationTaskId, setCurationTaskId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const curationSession = useChatSession(curationTaskId ?? "");
  const curationRunning =
    curationSession !== null &&
    curationSession.status !== "ended" &&
    curationSession.status !== "error" &&
    curationSession.status !== "awaiting-input";
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // Per-node drag overrides (graph dots are draggable; Reset view clears them).
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDragRef = useRef<{ key: string; x: number; y: number } | null>(null);

  // Notification "View" landed us here — bind the last run and open its log.
  useEffect(() => {
    const last = getLastCurationTaskId();
    if (last && curationTaskId === null) setCurationTaskId(last);
    if (consumeCurationLogOpen() && (last || curationTaskId)) setLogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const el = getElectron();
      if (!el) return;
      // Two passes: gather every knowledge file (org + each project's
      // facts/notes/projects, mirroring the outputs panel's All view), THEN
      // parse links against the full name set so cross-scope edges resolve.
      type Raw = { name: string; content: string; scope: "org" | "workspace"; scopeLabel: string };
      const raw: Raw[] = [];
      const dir = `${await el.getUserDataDir()}/org-knowledge`;
      const orgListing = await el.files.list(dir);
      if (orgListing.ok) {
        for (const f of orgListing.files) {
          if (!f.startsWith("facts/") || !f.endsWith(".md")) continue;
          const r = await el.files.read(dir, f);
          if (r.ok && r.kind === "text") {
            raw.push({ name: f.slice("facts/".length, -3), content: r.content, scope: "org", scopeLabel: "org" });
          }
        }
      }
      const wanted = (f: string) =>
        (f.startsWith("knowledge/facts/") ||
          f.startsWith("knowledge/notes/") ||
          f.startsWith("knowledge/projects/")) &&
        f.endsWith(".md");
      for (const proj of projects ?? []) {
        for (const root of [proj.path, `${proj.path}/.concourse`]) {
          const listing = await el.files.list(root);
          if (!listing.ok) continue;
          for (const f of listing.files.filter(wanted)) {
            const r = await el.files.read(root, f);
            if (r.ok && r.kind === "text") {
              raw.push({
                name: f.split("/").pop()!.slice(0, -3),
                content: r.content,
                scope: "workspace",
                scopeLabel: proj.name,
              });
            }
          }
        }
        if (cancelled) return;
      }
      const nameSet = new Set(raw.map((r) => r.name));
      const loaded = raw.map((r) => parseFact(r.name, r.content, nameSet, r.scope, r.scopeLabel));
      if (!cancelled) setFacts(loaded.sort((a, b) => a.key.localeCompare(b.key)));
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, projects]);

  const setCurationEnabled = useCallback(
    async (enabled: boolean) => {
      await api.updateSettings({ orgCurationEnabled: enabled });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    [queryClient],
  );

  const curateNow = useCallback(async () => {
    if (curating) return;
    setCurating(true);
    try {
      const taskId = await startOrgCuration(projects ?? [], { force: true });
      if (taskId) {
        setCurationTaskId(taskId);
        setLogOpen(true);
        await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      } else {
        toast.error("Could not start curation — add at least one project first.");
      }
    } finally {
      setCurating(false);
    }
  }, [curating, projects, queryClient]);

  const lastRun = settings?.orgCurationLastRunAt ?? null;
  const nextDue = lastRun ? lastRun + ORG_CURATION_INTERVAL_MS : null;

  // Hub-and-spoke layout: one hub per scope (org + each project that has
  // knowledge), knowledge nodes clustered around the outer ring near their
  // hub, faint spokes hub→node, accent edges for real knowledge links.
  const graph = useMemo(() => {
    const R = 150;
    const HUB_R = 55;
    const cx = 210;
    const cy = 180;
    const pos = new Map<string, { x: number; y: number }>();
    // facts are sorted by key = "<scope>:<name>", so scopes arrive clustered.
    facts.forEach((f, i) => {
      const angle = (2 * Math.PI * i) / Math.max(facts.length, 1) - Math.PI / 2;
      pos.set(f.key, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
    });
    // Hubs at the mean angle of their cluster, on an inner ring.
    const hubs: Array<{ key: string; label: string; scope: "org" | "workspace" }> = [];
    const byScope = new Map<string, number[]>();
    facts.forEach((f, i) => {
      const list = byScope.get(f.scopeLabel) ?? [];
      list.push(i);
      byScope.set(f.scopeLabel, list);
    });
    for (const [label, idxs] of byScope) {
      const mean = idxs.reduce((a, b) => a + b, 0) / idxs.length;
      const angle = (2 * Math.PI * mean) / Math.max(facts.length, 1) - Math.PI / 2;
      const key = `hub:${label}`;
      pos.set(key, { x: cx + HUB_R * Math.cos(angle), y: cy + HUB_R * Math.sin(angle) });
      hubs.push({ key, label, scope: label === "org" ? "org" : "workspace" });
    }
    const hubEdges = facts.map((f) => ({ from: `hub:${f.scopeLabel}`, to: f.key }));
    const edges: Array<{ from: string; to: string }> = [];
    const seen = new Set<string>();
    for (const f of facts) {
      for (const linkName of f.links) {
        for (const target of facts.filter((t) => t.name === linkName && t.key !== f.key)) {
          const id = [f.key, target.key].sort().join("|");
          if (!seen.has(id)) {
            seen.add(id);
            edges.push({ from: f.key, to: target.key });
          }
        }
      }
    }
    // "Linked" means real knowledge links — every node has a hub spoke.
    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(e.from);
      linked.add(e.to);
    }
    return { pos, edges, hubEdges, hubs, linked, cx, cy };
  }, [facts]);

  const effPos = (key: string) => {
    const base = graph.pos.get(key);
    if (!base) return null;
    const off = nodeOffsets[key];
    return off ? { x: base.x + off.x, y: base.y + off.y } : base;
  };

  return (
    <SettingsSection
      title="Knowledge"
      subtitle="The org brain: shared facts every project and engine can use, kept clean automatically."
      headingLevel="h1"
    >
      <Field label={`Background curation`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          <ToggleRow
            title="Curate automatically"
            label="Toggle automatic knowledge curation"
            description="Weekly background pass: splits overloaded facts, merges duplicates, archives expired snapshots, refreshes descriptions. Runs hidden (file tools only, no shell); every change is logged to curation-log.md and the session stays visible in its host project."
            checked={settings?.orgCurationEnabled ?? true}
            onChange={(v) => void setCurationEnabled(v)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Btn
              variant="ghost"
              icon="refresh"
              onClick={() => void curateNow()}
              disabled={curating || curationRunning}
            >
              {curating ? "Starting…" : curationRunning ? "Running…" : "Curate now"}
            </Btn>
            {curationTaskId && (
              <Btn variant="ghost" size="sm" onClick={() => setLogOpen(true)}>
                View log
              </Btn>
            )}
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {lastRun
                ? `Last run ${new Date(lastRun).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${
                    nextDue ? ` · next ${new Date(nextDue).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""
                  }`
                : "Never run yet"}
            </span>
          </div>
        </div>
      </Field>

      <Field label="Knowledge">
        <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 640 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {facts.filter((f) => f.scope === "org").length}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
            shared org facts ·
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {facts.filter((f) => f.scope === "workspace").length}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
            local project facts &amp; notes
            {facts.length > 0 ? ` · ~${INDEX_CLIFF} before a retrieval index is needed` : ""}
          </span>
          <Btn variant="ghost" size="sm" icon="refresh" onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh" style={{ width: 30, padding: 0 }}>
            {""}
          </Btn>
        </div>
      </Field>

      {facts.length > 1 && (
        <Field label="Knowledge graph — knowledge branches from its project; links are edges">
          <svg
            viewBox="0 0 420 360"
            style={{
              width: "100%",
              height: 440,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              cursor: dragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDragging(true);
              dragRef.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              if (nodeDragRef.current) {
                const d = nodeDragRef.current;
                const dx = (e.clientX - d.x) / view.scale;
                const dy = (e.clientY - d.y) / view.scale;
                nodeDragRef.current = { key: d.key, x: e.clientX, y: e.clientY };
                setNodeOffsets((cur) => {
                  const prev = cur[d.key] ?? { x: 0, y: 0 };
                  return { ...cur, [d.key]: { x: prev.x + dx, y: prev.y + dy } };
                });
                return;
              }
              if (!dragging || !dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              dragRef.current = { x: e.clientX, y: e.clientY };
              setView((v) => ({ ...v, tx: v.tx + dx / v.scale, ty: v.ty + dy / v.scale }));
            }}
            onPointerUp={() => {
              setDragging(false);
              dragRef.current = null;
              nodeDragRef.current = null;
            }}
          >
            <g transform={`translate(${210 + view.tx * view.scale - 210 * view.scale} ${180 + view.ty * view.scale - 180 * view.scale}) scale(${view.scale})`}>
            {graph.hubEdges.map((e) => {
              const a = effPos(e.from);
              const b = effPos(e.to);
              if (!a || !b) return null;
              return (
                <line
                  key={`h-${e.from}-${e.to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
              );
            })}
            {graph.edges.map((e) => {
              const a = effPos(e.from);
              const b = effPos(e.to);
              if (!a || !b) return null;
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--accent)"
                  strokeOpacity={0.55}
                  strokeWidth={1.4}
                />
              );
            })}
            {graph.hubs.map((h) => {
              const p = effPos(h.key)!;
              return (
                <g
                  key={h.key}
                  style={{ cursor: "move" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    nodeDragRef.current = { key: h.key, x: e.clientX, y: e.clientY };
                  }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={11}
                    fill="var(--surface-1)"
                    stroke={h.scope === "org" ? "var(--accent)" : "var(--status-done)"}
                    strokeWidth={2}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3}
                    textAnchor="middle"
                    style={{ fontSize: 8, fontWeight: 700, fill: "var(--text)", fontFamily: "var(--mono)" }}
                  >
                    {h.label.length > 10 ? `${h.label.slice(0, 9)}…` : h.label}
                  </text>
                </g>
              );
            })}
            {facts.map((f) => {
              const p = effPos(f.key)!;
              const isolated = !graph.linked.has(f.key);
              return (
                <g
                  key={f.key}
                  style={{ cursor: "move" }}
                  // Double-click opens the fact — a single click is too easy to
                  // fire accidentally on drag release.
                  onDoubleClick={() => setPreview(f)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    nodeDragRef.current = { key: f.key, x: e.clientX, y: e.clientY };
                  }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={7}
                    fill={isolated ? "var(--surface-1)" : f.scope === "org" ? "var(--accent)" : "var(--status-done)"}
                    stroke="var(--border)"
                  />
                  <title>{`${f.scopeLabel} · ${f.name}`}</title>
                  <text
                    x={p.x}
                    y={p.y + (p.y >= graph.cy ? 20 : -12)}
                    textAnchor="middle"
                    style={{ fontSize: 9, fill: "var(--text-dim)", fontFamily: "var(--mono)" }}
                  >
                    {f.name.length > 30 ? `${f.name.slice(0, 28)}…` : f.name}
                  </text>
                </g>
              );
            })}
            </g>
          </svg>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              Drag dots to arrange · drag background to pan · double-click a dot to read it. Ring hubs = where knowledge lives (org / project); hollow = no links yet.
            </span>
            <Btn
              variant="ghost"
              size="sm"
              icon="zoom-in"
              aria-label="Zoom in"
              onClick={() => setView((v) => ({ ...v, scale: Math.min(6, v.scale * 1.3) }))}
              style={{ width: 30, padding: 0 }}
            >
              {""}
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              icon="zoom-out"
              aria-label="Zoom out"
              onClick={() => setView((v) => ({ ...v, scale: Math.max(0.4, v.scale / 1.3) }))}
              style={{ width: 30, padding: 0 }}
            >
              {""}
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                setView({ scale: 1, tx: 0, ty: 0 });
                setNodeOffsets({});
              }}
            >
              Reset view
            </Btn>
          </div>
        </Field>
      )}

      {/* Live curation log — a log view, not a chat: closing it never stops
          the job (the session lives in the store, not this popup). */}
      <Modal
        open={logOpen && curationTaskId !== null}
        onClose={() => setLogOpen(false)}
        title="Knowledge curation"
        width={720}
        footer={
          <span style={{ fontSize: 12, color: "var(--text-dim)", marginRight: "auto" }}>
            {curationRunning
              ? "Running in the background — closing this window does not stop it."
              : "Finished. Changes are logged to curation-log.md."}
          </span>
        }
      >
        <div
          style={{
            maxHeight: "50vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
          }}
        >
          {(curationSession?.items ?? [])
            .map((it, i) => ({ line: summarizeChatItem(it), key: i }))
            .filter((x) => x.line !== null)
            .map((x) => (
              <div key={x.key} style={{ color: "var(--text-dim)", whiteSpace: "pre-wrap" }}>
                {x.line}
              </div>
            ))}
          {curationRunning && (
            <div style={{ color: "var(--accent)" }}>▸ working…</div>
          )}
          {!curationSession && (
            <div style={{ color: "var(--text-faint)" }}>Starting…</div>
          )}
        </div>
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ""}
        width={760}
      >
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {preview && <Markdown>{preview.content.replace(/^---\s*\n[\s\S]*?\n---\s*/, "")}</Markdown>}
        </div>
      </Modal>
    </SettingsSection>
  );
}
