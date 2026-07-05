import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { SessionAvatar } from "~/components/ui/SessionAvatar";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { TextField } from "~/components/ui/TextField";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { isSessionIcon, SESSION_ICON_OPTIONS } from "~/lib/session-icons";
import { Z_INDEX } from "~/lib/z-index";
import type { Task } from "~/db/schema";

// Session avatar editor, mirroring the project icon experience: custom image,
// short monogram, the lucide icon vocabulary, and color — all persisted on the
// task row. Kept as a self-contained dialog opened from the card's icon tile.

export function SessionIconDialog({
  task,
  open,
  onClose,
  onSaved,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [icon, setIcon] = useState<string | null>(task.icon);
  const [iconColor, setIconColor] = useState<string | null>(task.iconColor ?? null);
  const [imagePath, setImagePath] = useState<string | null>(task.imagePath ?? null);
  const [monogramDraft, setMonogramDraft] = useState("");
  const [iconQuery, setIconQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIcon(task.icon);
    setIconColor(task.iconColor ?? null);
    setImagePath(task.imagePath ?? null);
    setMonogramDraft(task.icon && !isSessionIcon(task.icon) ? task.icon : "");
    setIconQuery("");
    setError(null);
  }, [open, task]);

  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return SESSION_ICON_OPTIONS;
    return SESSION_ICON_OPTIONS.filter(
      (o) => o.id.includes(q) || o.hint.toLowerCase().includes(q),
    );
  }, [iconQuery]);

  if (!open) return null;

  const preview: Task = { ...task, icon, iconColor, imagePath };

  const chooseImage = async () => {
    setError(null);
    const electron = getElectron();
    if (!electron) return;
    const picked = await electron.pickImage();
    if (!picked) return;
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    setUploading(true);
    try {
      // Reuses the project-image store/protocol; task ids are unique filenames.
      const result = await electron.saveProjectImage({
        projectId: task.id,
        sourcePath: picked.sourcePath,
        extension: picked.extension,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setImagePath(result.filename);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const { task: updated } = await api.updateTask(task.id, {
        icon,
        iconColor,
        imagePath,
      });
      onSaved(updated);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const label: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 10.5,
    fontWeight: 500,
    color: "var(--text-dim)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 6,
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Session icon"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z_INDEX.popover,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CardFrame
        glow
        solid
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 96px)",
          overflow: "auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <SessionAvatar task={preview} size={56} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Session icon</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{task.title}</div>
          </div>
        </div>

        <div>
          <label style={label}>Custom image</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="solid" icon="folder" onClick={() => void chooseImage()} disabled={uploading}>
              {uploading ? "Uploading…" : imagePath ? "Replace image…" : "Choose image…"}
            </Btn>
            {imagePath && (
              <Btn variant="ghost" onClick={() => setImagePath(null)}>
                Remove
              </Btn>
            )}
          </div>
        </div>

        <div>
          <label style={label}>Letters (fallback when no image)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ width: 120 }}>
              <TextField
                mono
                value={monogramDraft}
                onChange={(v) => {
                  const next = v.slice(0, 3);
                  setMonogramDraft(next);
                  if (next.trim()) setIcon(next.trim());
                  else if (icon && !isSessionIcon(icon)) setIcon(null);
                }}
                placeholder={task.title.slice(0, 2).toUpperCase()}
              />
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              1–3 characters, shown like a project monogram
            </span>
          </div>
        </div>

        <div>
          <label style={label}>Icon</label>
          <TextField mono value={iconQuery} onChange={setIconQuery} placeholder="Search icons…" />
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))",
              gap: 6,
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {filteredIcons.map((o) => {
              const selected = icon === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  title={o.hint}
                  onClick={() => {
                    setIcon(o.id);
                    setMonogramDraft("");
                  }}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    background: selected ? "var(--accent-faint)" : "transparent",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    color: selected ? "var(--accent)" : "var(--text-dim)",
                  }}
                >
                  <SessionIcon name={o.id} size={18} strokeWidth={1.6} />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={label}>Color</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              title="Default"
              onClick={() => setIconColor(null)}
              aria-pressed={iconColor === null}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                cursor: "pointer",
                background: "var(--surface-2)",
                border: `2px solid ${iconColor === null ? "var(--accent)" : "var(--border)"}`,
              }}
            />
            {ICON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => setIconColor(c)}
                aria-pressed={iconColor === c}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: c,
                  border: `2px solid ${iconColor === c ? "var(--text)" : "transparent"}`,
                }}
              />
            ))}
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Btn
            variant="ghost"
            onClick={() => {
              setIcon(null);
              setIconColor(null);
              setImagePath(null);
              setMonogramDraft("");
            }}
          >
            Reset to default
          </Btn>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Btn>
          </div>
        </div>
      </CardFrame>
    </div>,
    document.body,
  );
}
