import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { EscTooltip } from "~/components/ui/Tooltip";
import { api } from "~/lib/api";
import type { Project } from "~/db/schema";
import type { ProjectCommand } from "~/shared/projects";

// Small hover-able icon button for custom-command actions (share / delete).
const iconBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 6,
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-dim)",
  cursor: "pointer",
  flexShrink: 0,
};

// A non-technical "what do you want to do?" picker. Instead of dropping the user
// into a terminal, it lists the project's Claude Code commands (from
// .claude/commands) as friendly cards. Picking one launches the command for
// them; the terminal still runs underneath but they never have to type.

// A small emoji per command keyword so the list reads at a glance. Falls back to
// a neutral icon. Purely cosmetic — matching is best-effort on the command name.
const ICON_RULES: Array<[RegExp, string]> = [
  [/summary|report|weekly|review/, "📊"],
  [/okr|goal|decision|brief/, "📝"],
  [/workflow|story|stories|jira|sprint|plan/, "🚀"],
  [/runbook|incident|escalat|support|ticket/, "🛟"],
  [/campaign|content|performance|market/, "📣"],
  [/ask|question|research|doc/, "🔎"],
  [/risk|retro/, "🧭"],
];

export function iconFor(name: string): string {
  for (const [re, icon] of ICON_RULES) if (re.test(name)) return icon;
  return "⚡";
}

export function CommandPicker({
  open,
  project,
  onClose,
  onPick,
  onPickChat,
  onPickCreateWorkflow,
  onImportWorkflow,
  onShareCommand,
  onDeleteCommand,
  onEditCommand,
  onAdvanced,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onPick: (command: ProjectCommand) => void;
  onPickChat: () => void;
  onPickCreateWorkflow: () => void;
  onImportWorkflow: () => void;
  onShareCommand: (name: string) => void;
  onDeleteCommand: (name: string) => void;
  onEditCommand: (command: ProjectCommand) => void;
  onAdvanced: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-commands", project?.id],
    queryFn: () => api.projectCommands(project!.id),
    enabled: open && !!project,
    // Refetch each time the picker opens so newly created / imported / deleted
    // workflows show up without a manual refresh.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // `create-workflow` is surfaced as its own card above, so keep it out of the list.
  const commands = (data?.commands ?? []).filter((c) => c.name !== "create-workflow");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What would you like to do?"
      width={560}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
          </EscTooltip>
          <Btn variant="ghost" icon="download" onClick={onImportWorkflow}>
            Import a workflow
          </Btn>
          <Btn variant="ghost" icon="terminal" onClick={onAdvanced}>
            Open a terminal session
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Start a plain chat, or pick a task and {project?.name ?? "the workspace"} will run it
          for you — no commands to type.
        </div>

        {/* Plain chat — no command required. Kept visually distinct (accent
            tint) and pinned to the top so it's the obvious default. */}
        <button
          onClick={onPickChat}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            padding: "12px 14px",
            background: "var(--accent-faint)",
            border: "1px solid var(--accent-border)",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--text)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--accent-dim)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-border)";
            e.currentTarget.style.background = "var(--accent-faint)";
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            💬
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>Just chat</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Ask anything — no command needed.
            </div>
          </div>
        </button>

        {/* Create a workflow — guided builder that generates a reusable command. */}
        <button
          onClick={onPickCreateWorkflow}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px dashed var(--accent-border)",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--text)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.background = "var(--accent-faint)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-border)";
            e.currentTarget.style.background = "var(--surface-0)";
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            🛠️
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>
              Create a workflow
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Answer a few questions and I'll build a reusable command for you.
            </div>
          </div>
        </button>

        {isLoading && (
          <div style={{ padding: "16px 0", fontSize: 13, color: "var(--text-dim)" }}>
            Loading available tasks…
          </div>
        )}

        {isError && (
          <div style={{ padding: "16px 0", fontSize: 13, color: "var(--status-failed)" }}>
            Could not load this workspace's tasks.
          </div>
        )}

        {!isLoading && !isError && commands.length === 0 && (
          <div style={{ padding: "16px 0", fontSize: 13, color: "var(--text-dim)" }}>
            This workspace has no commands yet. Use “Open a terminal session” to start one
            manually.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {commands.map((cmd) => (
            <div
              key={cmd.name}
              role="button"
              tabIndex={0}
              onClick={() => onPick(cmd)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(cmd);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                padding: "12px 14px",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                cursor: "pointer",
                color: "var(--text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--surface-0)";
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {cmd.icon || iconFor(cmd.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  {cmd.title}
                  {cmd.custom && (
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "var(--accent)",
                        border: "1px solid var(--accent-border)",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      Custom
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-dim)",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cmd.description || `Run /${cmd.name}`}
                </div>
              </div>
              {cmd.custom && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label={`Edit ${cmd.title}`}
                    title="Edit title, description, icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCommand(cmd);
                    }}
                    style={iconBtnStyle}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Share ${cmd.title}`}
                    title="Share / export"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShareCommand(cmd.name);
                    }}
                    style={iconBtnStyle}
                  >
                    <Icon name="upload" size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${cmd.title}`}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCommand(cmd.name);
                    }}
                    style={iconBtnStyle}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
