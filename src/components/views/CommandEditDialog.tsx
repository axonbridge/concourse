import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { useHotkey } from "~/lib/use-hotkey";
import { getElectron } from "~/lib/electron";
import type { ProjectCommand } from "~/shared/projects";

// A small palette so non-technical users can pick an icon without an emoji
// keyboard. They can still type any emoji into the field.
const ICON_CHOICES = ["🚀", "📊", "📝", "🔎", "📣", "🛟", "🧭", "📅", "✅", "📦", "🤖", "⚡", "💡", "📈"];

// Edit a custom workflow's display fields (title / description / icon). Only
// offered for `custom` commands; persists to the command file's frontmatter.
export function CommandEditDialog({
  open,
  command,
  fallbackIcon,
  onClose,
  onSave,
}: {
  open: boolean;
  command: ProjectCommand | null;
  fallbackIcon: string;
  onClose: () => void;
  onSave: (patch: {
    title: string;
    description: string;
    icon: string;
    template?: string | null;
  }) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);
  // Template edit intent: undefined = leave as-is; string = new uploaded content;
  // null = remove the existing template.
  const [templateChange, setTemplateChange] = useState<string | null | undefined>(undefined);
  const [templateFileName, setTemplateFileName] = useState<string | null>(null);

  const hasExistingTemplate = !!command?.template;
  const templateStatus =
    templateChange === null
      ? "Will be removed on save"
      : typeof templateChange === "string"
        ? `New: ${templateFileName ?? "uploaded file"}`
        : hasExistingTemplate
          ? "A template is attached"
          : "No template — output format is defined in the workflow";

  useEffect(() => {
    if (open && command) {
      setTitle(command.title);
      setDescription(command.description);
      setIcon(command.icon || fallbackIcon);
      setTemplateChange(undefined);
      setTemplateFileName(null);
      setSaving(false);
    }
  }, [open, command, fallbackIcon]);

  const uploadTemplate = async () => {
    const picked = await getElectron()?.pickTemplateFile();
    if (!picked) return;
    setTemplateChange(picked.content);
    setTemplateFileName(picked.name);
    toast.success(`Attached ${picked.name}.`);
  };

  const submit = async () => {
    if (!command || saving) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || command.title,
        description: description.trim(),
        icon: icon.trim() || fallbackIcon,
        template: templateChange,
      });
    } finally {
      setSaving(false);
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit workflow"
      width={480}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Sprint Ticket Export" />

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
            placeholder="What this workflow does…"
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
            Icon
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setIcon(choice)}
                style={{
                  width: 34,
                  height: 34,
                  fontSize: 17,
                  borderRadius: 7,
                  cursor: "pointer",
                  background: icon === choice ? "var(--accent-faint)" : "var(--surface-0)",
                  border: `1px solid ${icon === choice ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>

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
            Output template
          </label>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8, lineHeight: 1.5 }}>
            {templateStatus}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" icon="upload" onClick={() => void uploadTemplate()}>
              {hasExistingTemplate || typeof templateChange === "string"
                ? "Replace template…"
                : "Upload template…"}
            </Btn>
            {(hasExistingTemplate || typeof templateChange === "string") && (
              <Btn
                variant="ghost"
                icon="trash"
                onClick={() => {
                  setTemplateChange(null);
                  setTemplateFileName(null);
                }}
              >
                Remove template
              </Btn>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
