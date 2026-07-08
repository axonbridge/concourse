import { useEffect, useMemo, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { EscTooltip } from "~/components/ui/Tooltip";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import type { KnowledgeManifest } from "~/shared/projects";
import { toast } from "sonner";

// Share knowledge (agreed 2026-07-06): export this project's knowledge facts
// (+ optional notes) with workflows attached, as an OKF folder a teammate
// imports to start from the same foundation. The checklist IS the review step
// — every file that will leave the machine is visible, and flagged files
// (secrets / machine paths / point-in-time snapshots) cannot be selected.
// Org-scope facts never appear here: they live in userData, not the project.

const FLAG_LABEL: Record<string, string> = {
  secret: "contains a secret",
  "machine-path": "contains a machine path",
  "point-in-time": "snapshot — stale on arrival",
};

export function ShareKnowledgeDialog({
  open,
  projectId,
  projectName,
  onClose,
}: {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState<KnowledgeManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedFacts, setSelectedFacts] = useState<Set<string>>(new Set());
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setManifest(null);
    setLoading(true);
    let cancelled = false;
    void api
      .knowledgeManifest(projectId)
      .then(({ manifest }) => {
        if (cancelled) return;
        setManifest(manifest);
        // Defaults: clean facts + all workflows checked; handoff notes
        // pre-checked (they exist to travel); other notes opt-in (they are
        // the more personal/sensitive scope).
        setSelectedFacts(
          new Set(manifest.facts.filter((f) => f.flags.length === 0).map((f) => f.name)),
        );
        setSelectedNotes(
          new Set(
            manifest.notes
              .filter((n) => n.flags.length === 0 && /-handoff$/.test(n.name))
              .map((n) => n.name),
          ),
        );
        setSelectedWorkflows(new Set(manifest.workflows.map((w) => w.name)));
        // Documents referenced by a handoff note travel by default.
        setSelectedDocuments(
          new Set(
            (manifest.documents ?? [])
              .filter((d) => d.flags.length === 0 && d.suggested)
              .map((d) => d.name),
          ),
        );
        // Attachments (often screenshots) are the most personal scope — only
        // ones a handoff note explicitly mentions travel by default.
        setSelectedAttachments(
          new Set((manifest.attachments ?? []).filter((a) => a.suggested).map((a) => a.name)),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not read knowledge");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const total =
    selectedFacts.size +
    selectedNotes.size +
    selectedWorkflows.size +
    selectedDocuments.size +
    selectedAttachments.size;
  const empty = useMemo(
    () =>
      !!manifest &&
      manifest.facts.length === 0 &&
      manifest.notes.length === 0 &&
      manifest.workflows.length === 0 &&
      (manifest.documents ?? []).length === 0 &&
      (manifest.attachments ?? []).length === 0,
    [manifest],
  );

  const exportBundle = async () => {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const { bundle } = await api.knowledgeBundle(projectId, {
        facts: [...selectedFacts],
        notes: [...selectedNotes],
        workflows: [...selectedWorkflows],
        documents: [...selectedDocuments],
        attachments: [...selectedAttachments],
      });
      const res = await getElectron()?.saveKnowledgeBundleFile(
        `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-knowledge`,
        JSON.stringify(bundle, null, 2),
      );
      if (res?.ok) {
        toast.success(
          `Exported ${selectedFacts.size} facts${selectedNotes.size ? `, ${selectedNotes.size} notes` : ""}${selectedDocuments.size ? `, ${selectedDocuments.size} documents` : ""}${selectedWorkflows.size ? ` and ${selectedWorkflows.size} workflows` : ""}.`,
        );
        onClose();
      } else if (res && res.error) {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const toggle = (set: Set<string>, apply: (next: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    apply(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share knowledge"
      width={640}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose} disabled={exporting}>
              Cancel
            </Btn>
          </EscTooltip>
          <Btn
            variant="primary"
            icon="upload"
            onClick={() => void exportBundle()}
            disabled={exporting || total === 0}
          >
            {exporting ? "Exporting…" : `Export ${total} item${total === 1 ? "" : "s"}`}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: "58vh", overflow: "auto" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Everything checked below is written into one shareable folder. A teammate imports
          it to start from this knowledge foundation — their newer facts are never
          overwritten. Files with secrets, machine paths, or point-in-time snapshots can't
          be shared. To capture where you left off mid-task, press <b>Handoff</b> in that
          chat first — the note it writes shows up here, pre-checked.
        </p>

        {loading && (
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Reading knowledge…</div>
        )}
        {empty && (
          <div
            style={{
              padding: 16,
              border: "1px dashed var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-faint)",
              textAlign: "center",
            }}
          >
            Nothing to share yet — facts appear here as this project's AI saves what it learns.
          </div>
        )}

        {manifest && manifest.facts.length > 0 && (
          <Section title={`Knowledge facts (${manifest.facts.length})`}>
            {manifest.facts.map((f) => (
              <CheckRow
                key={f.name}
                name={f.name}
                description={f.description}
                disabledReason={f.flags[0] ? (FLAG_LABEL[f.flags[0].kind] ?? f.flags[0].kind) : null}
                checked={selectedFacts.has(f.name)}
                onToggle={() => toggle(selectedFacts, setSelectedFacts, f.name)}
              />
            ))}
          </Section>
        )}

        {manifest && manifest.notes.length > 0 && (
          <Section title={`Notes (${manifest.notes.length}) — handoff notes pre-checked; others opt-in`}>
            {manifest.notes.map((n) => (
              <CheckRow
                key={n.name}
                name={n.name}
                description={n.description}
                disabledReason={n.flags[0] ? (FLAG_LABEL[n.flags[0].kind] ?? n.flags[0].kind) : null}
                checked={selectedNotes.has(n.name)}
                onToggle={() => toggle(selectedNotes, setSelectedNotes, n.name)}
              />
            ))}
          </Section>
        )}

        {manifest && (manifest.documents ?? []).length > 0 && (
          <Section
            title={`Documents (${manifest.documents.length}) — outputs referenced by a handoff note are pre-checked`}
          >
            {manifest.documents.map((d) => (
              <CheckRow
                key={d.name}
                name={d.name}
                description=""
                disabledReason={d.flags[0] ? (FLAG_LABEL[d.flags[0].kind] ?? d.flags[0].kind) : null}
                checked={selectedDocuments.has(d.name)}
                onToggle={() => toggle(selectedDocuments, setSelectedDocuments, d.name)}
              />
            ))}
          </Section>
        )}

        {manifest && (manifest.attachments ?? []).length > 0 && (
          <Section
            title={`Attachments (${manifest.attachments.length}) — chat inputs like screenshots; opt-in unless a handoff note mentions them`}
          >
            {manifest.attachments.map((a) => (
              <CheckRow
                key={a.name}
                name={a.name}
                description=""
                disabledReason={null}
                checked={selectedAttachments.has(a.name)}
                onToggle={() => toggle(selectedAttachments, setSelectedAttachments, a.name)}
              />
            ))}
          </Section>
        )}

        {manifest && manifest.workflows.length > 0 && (
          <Section title={`Workflows attached (${manifest.workflows.length})`}>
            {manifest.workflows.map((w) => (
              <CheckRow
                key={w.name}
                name={`/${w.name}`}
                description={w.title}
                disabledReason={null}
                checked={selectedWorkflows.has(w.name)}
                onToggle={() => toggle(selectedWorkflows, setSelectedWorkflows, w.name)}
              />
            ))}
          </Section>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
          padding: "2px 0",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function CheckRow({
  name,
  description,
  disabledReason,
  checked,
  onToggle,
}: {
  name: string;
  description: string;
  disabledReason: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const disabled = disabledReason !== null;
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={onToggle}
        style={{ marginTop: 2 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        {(description || disabled) && (
          <div style={{ fontSize: 11.5, color: disabled ? "var(--status-failed)" : "var(--text-dim)" }}>
            {disabled ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="x" size={10} /> {disabledReason}
              </span>
            ) : (
              description
            )}
          </div>
        )}
      </div>
    </label>
  );
}
