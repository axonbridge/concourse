import { useEffect, useMemo, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { SessionAvatar } from "~/components/ui/SessionAvatar";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { TextField } from "~/components/ui/TextField";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { isSessionIcon, SESSION_ICON_OPTIONS } from "~/lib/session-icons";
import { useHotkey } from "~/lib/use-hotkey";
import type { Task } from "~/db/schema";

export type TaskEditPatch = {
  title: string;
  description: string;
  icon: string | null;
  iconColor: string | null;
  imagePath: string | null;
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--text-dim)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  display: "block",
  marginBottom: 6,
};

// Edit a session card: title, description, and the avatar (custom image /
// monogram letters / lucide icon / color) — the same experience as projects.
export function TaskEditDialog({
  open,
  task,
  onClose,
  onSave,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (patch: TaskEditPatch) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [monogramDraft, setMonogramDraft] = useState("");
  const [iconQuery, setIconQuery] = useState("");
  const [showIconGrid, setShowIconGrid] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setIcon(task.icon);
      setIconColor(task.iconColor ?? null);
      setImagePath(task.imagePath ?? null);
      setMonogramDraft(task.icon && !isSessionIcon(task.icon) ? task.icon : "");
      setIconQuery("");
      setShowIconGrid(false);
      setUploading(false);
      setSaving(false);
      setError(null);
    }
  }, [open, task]);

  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return SESSION_ICON_OPTIONS;
    return SESSION_ICON_OPTIONS.filter(
      (o) => o.id.includes(q) || o.hint.toLowerCase().includes(q),
    );
  }, [iconQuery]);

  const chooseImage = async () => {
    if (!task) return;
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

  const submit = async () => {
    if (!task || saving) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setSaving(true);
    try {
      await onSave({
        title: nextTitle,
        description: description.trim(),
        icon,
        iconColor,
        imagePath,
      });
    } finally {
      setSaving(false);
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  const preview = task ? { ...task, title: title || task.title, icon, iconColor, imagePath } : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit session"
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          {preview && <SessionAvatar task={preview} size={52} />}
          <div style={{ flex: 1 }}>
            <TextField label="Title" value={title} onChange={setTitle} placeholder="Session title" />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="Shown under the title on the session card. Leave empty to show the latest message."
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontFamily: "var(--sans)",
              fontSize: 13,
              lineHeight: 1.5,
              padding: "9px 11px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div>
          <label style={labelStyle}>Custom image</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="solid" icon="folder" onClick={() => void chooseImage()} disabled={uploading}>
              {uploading ? "Uploading…" : imagePath ? "Replace image…" : "Choose image…"}
            </Btn>
            {imagePath && (
              <Btn variant="ghost" onClick={() => setImagePath(null)}>
                Remove
              </Btn>
            )}
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-faint)" }}>
              PNG / JPG / WebP / GIF, ≤ 5MB
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Icon (fallback)</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 72 }}>
              <TextField
                mono
                value={monogramDraft}
                onChange={(v) => {
                  const next = v.slice(0, 3);
                  setMonogramDraft(next);
                  if (next.trim()) setIcon(next.trim());
                  else if (icon && !isSessionIcon(icon)) setIcon(null);
                }}
                placeholder={(title || task?.title || "").slice(0, 2).toUpperCase() || "AB"}
              />
            </div>
            {ICON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => setIconColor(iconColor === c ? null : c)}
                aria-pressed={iconColor === c}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: c,
                  border: `2px solid ${iconColor === c ? "var(--text)" : "transparent"}`,
                }}
              />
            ))}
            <Btn variant="ghost" onClick={() => setShowIconGrid((v) => !v)}>
              {showIconGrid ? "Hide icons" : "Pick an icon…"}
            </Btn>
          </div>
          {showIconGrid && (
            <div style={{ marginTop: 10 }}>
              <TextField mono value={iconQuery} onChange={setIconQuery} placeholder="Search icons…" />
              <div
                style={{
                  marginTop: 8,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))",
                  gap: 6,
                  maxHeight: 150,
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
          )}
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
      </div>
    </Modal>
  );
}
