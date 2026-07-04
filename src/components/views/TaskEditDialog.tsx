import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { useHotkey } from "~/lib/use-hotkey";
import type { Task } from "~/db/schema";

// Edit a session card's title + description. Description is stored and shown as
// the card subtitle (falling back to the live preview when empty).
export function TaskEditDialog({
  open,
  task,
  onClose,
  onSave,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (patch: { title: string; description: string }) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setSaving(false);
    }
  }, [open, task]);

  const submit = async () => {
    if (!task || saving) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setSaving(true);
    try {
      await onSave({ title: nextTitle, description: description.trim() });
    } finally {
      setSaving(false);
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit session"
      width={460}
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
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Session title" />

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            }}
          >
            Description
          </label>
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
      </div>
    </Modal>
  );
}
