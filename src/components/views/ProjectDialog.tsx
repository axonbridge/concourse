import { useEffect, useRef, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { HotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { ICON_COLORS } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { ToggleRow } from "~/components/views/SettingsParts";
import type { Group, Project } from "~/db/schema";

export function ProjectDialog({
  open,
  project,
  initialPath = "",
  groups,
  onClose,
  onSave,
  onCreateGroup,
  onOpenLaunchCommands,
  onOpenCustomScripts,
}: {
  open: boolean;
  project: Project | null;
  initialPath?: string;
  groups: Group[];
  onClose: () => void;
  onSave: (data: {
    name?: string;
    path: string;
    icon?: string;
    iconColor: string;
    groupId: string | null;
    imagePath?: string | null;
    pendingImage?: { sourcePath: string; extension: string } | null;
    worktreeSetupCommand?: string | null;
    gitEnabled?: boolean;
    private?: boolean;
    /** Create mode only: the picked folder is empty — scaffold a workspace. */
    scaffoldWorkspace?: boolean;
    /** Create mode only: open the "Prepare for Concourse" chat after creating. */
    prepareWorkspace?: boolean;
  }) => Promise<void> | void;
  onCreateGroup?: (name: string) => Promise<Group> | Group;
  // Advanced actions (editing only) — open the per-project Launch commands /
  // Custom scripts editors. Provided by the project view; omitted on the
  // dashboard, where the Advanced section is hidden.
  onOpenLaunchCommands?: () => void;
  onOpenCustomScripts?: () => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  // Create mode: where the project comes from — an existing folder or a fresh clone.
  const [sourceMode, setSourceMode] = useState<"folder" | "clone">("folder");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const [cloning, setCloning] = useState(false);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [groupId, setGroupId] = useState<string>("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupTypeaheadOpen, setGroupTypeaheadOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [icon, setIcon] = useState("");
  const [iconColor, setIconColor] = useState("#ff5a1f");
  const [worktreeSetupCommand, setWorktreeSetupCommand] = useState("");
  const [gitEnabled, setGitEnabled] = useState(true);
  const [privateProject, setPrivateProject] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<
    { sourcePath: string; extension: string } | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const selectedGroup = groupId ? groups.find((group) => group.id === groupId) ?? null : null;
  const normalizedGroupQuery = groupQuery.trim().toLowerCase();
  const exactGroupMatch = normalizedGroupQuery
    ? groups.find((group) => group.name.toLowerCase() === normalizedGroupQuery) ?? null
    : null;
  const filteredGroups = normalizedGroupQuery
    ? groups.filter((group) => group.name.toLowerCase().includes(normalizedGroupQuery))
    : groups;
  const canCreateGroup =
    !!onCreateGroup && !!groupQuery.trim() && !exactGroupMatch;

  useEffect(() => {
    if (open) {
      const initialName = initialPath.split(/[\\/]/).filter(Boolean).pop() || "";
      nameRef.current?.focus();
      nameRef.current?.select();
      setName(project?.name || (!project ? initialName : ""));
      setPath(project?.path || (!project ? initialPath : ""));
      setGroupId(project?.groupId || "");
      setGroupQuery(
        project?.groupId
          ? groups.find((group) => group.id === project.groupId)?.name ?? ""
          : "",
      );
      setGroupTypeaheadOpen(false);
      setCreatingGroup(false);
      setIcon(project?.icon || "");
      setIconColor(project?.iconColor || "#ff5a1f");
      setWorktreeSetupCommand(project?.worktreeSetupCommand || "");
      setGitEnabled(project?.gitEnabled !== false);
      setPrivateProject(project?.private === true);
      setImagePath(project?.imagePath ?? null);
      setPendingImage(null);
      setError(null);
    }
  }, [initialPath, open, project?.id]);

  useEffect(() => {
    if (!open || !selectedGroup || groupQuery.trim()) return;
    setGroupQuery(selectedGroup.name);
  }, [groupQuery, open, selectedGroup]);

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
    if (!project) {
      // Create flow: defer upload until after the project exists.
      setPendingImage(picked);
      return;
    }
    setUploading(true);
    try {
      const result = await electron.saveProjectImage({
        projectId: project.id,
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

  const removeImage = () => {
    setImagePath(null);
    setPendingImage(null);
  };

  // Journey A: classify the picked folder (create mode) so an empty folder can
  // be offered as a fresh Concourse workspace. null = unknown/irrelevant.
  const [folderKind, setFolderKind] = useState<
    "missing" | "empty" | "cwf" | "legacy-claude" | "plain" | null
  >(null);
  useEffect(() => {
    if (project || !path.trim()) {
      setFolderKind(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .classifyFolder(path.trim())
        .then((r) => {
          if (!cancelled) setFolderKind(r.kind);
        })
        .catch(() => {
          if (!cancelled) setFolderKind(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [project, path]);

  const browse = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) {
      setPath(result);
      if (!name.trim()) {
        const basename = result.split(/[\\/]/).filter(Boolean).pop() || "";
        if (basename) setName(basename);
      }
    }
  };

  useEffect(() => {
    if (project || sourceMode !== "clone" || gitAvailable !== null) return;
    api
      .gitAvailable()
      .then((r) => setGitAvailable(r.available))
      .catch(() => setGitAvailable(null));
  }, [project, sourceMode, gitAvailable]);

  const browseCloneParent = async () => {
    const electron = getElectron();
    if (!electron) return;
    const result = await electron.browseFolder();
    if (result) setCloneParent(result);
  };

  const { createHomeSetupTerminal } = useUserTerminals();
  const installGit = async () => {
    // macOS: opens Apple's Command Line Tools installer (GUI). The terminal
    // records the attempt; cloning works once the install finishes.
    await createHomeSetupTerminal("Install Git", "xcode-select --install || true");
    setGitAvailable(null); // re-check next time clone mode is opened
  };

  const cloneRepoName = cloneUrl
    .replace(/\/+$/, "")
    .split(/[/:]/)
    .pop()
    ?.replace(/\.git$/i, "")
    .trim() || "";

  const selectGroup = (group: Group) => {
    setGroupId(group.id);
    setGroupQuery(group.name);
    setGroupTypeaheadOpen(false);
  };

  const clearGroup = () => {
    setGroupId("");
    setGroupQuery("");
    setGroupTypeaheadOpen(false);
  };

  const createAndSelectGroup = async (groupName: string): Promise<string | null> => {
    if (!onCreateGroup || creatingGroup) return groupId || null;
    setError(null);
    setCreatingGroup(true);
    try {
      const group = await onCreateGroup(groupName);
      selectGroup(group);
      return group.id;
    } catch (e: any) {
      setError(e?.message || "Could not add group");
      throw e;
    } finally {
      setCreatingGroup(false);
    }
  };

  const commitGroupQuery = async () => {
    const trimmed = groupQuery.trim();
    if (!trimmed) {
      clearGroup();
      return;
    }
    if (exactGroupMatch) {
      selectGroup(exactGroupMatch);
      return;
    }
    if (!onCreateGroup || creatingGroup) return;
    await createAndSelectGroup(trimmed);
  };

  const resolveGroupIdForSave = async (): Promise<string | null> => {
    const trimmed = groupQuery.trim();
    if (!trimmed) return null;
    if (exactGroupMatch) return exactGroupMatch.id;
    if (selectedGroup?.name === trimmed) return selectedGroup.id;
    if (onCreateGroup) return createAndSelectGroup(trimmed);
    return groupId || null;
  };

  const submit = async () => {
    setError(null);
    try {
      // Clone mode: clone first, then continue the normal add flow with the
      // fresh clone's path (classified so scaffold/prepare behave the same).
      let effectivePath = path;
      let effectiveKind = folderKind;
      if (!project && sourceMode === "clone") {
        if (!cloneUrl.trim()) throw new Error("Enter a repository URL");
        if (!cloneParent.trim()) throw new Error("Choose a destination folder");
        setCloning(true);
        try {
          const cloned = await api.cloneRepository({
            url: cloneUrl.trim(),
            parentDir: cloneParent.trim(),
            folderName: name.trim() || undefined,
          });
          effectivePath = cloned.path;
          effectiveKind = (await api.classifyFolder(cloned.path).catch(() => null))?.kind ?? null;
        } finally {
          setCloning(false);
        }
      }
      const effectiveGroupId = await resolveGroupIdForSave();
      const effectiveName =
        name.trim() || (effectivePath.trim().split(/[\\/]/).filter(Boolean).pop() ?? "");
      await onSave({
        name: name.trim() || undefined,
        path: effectivePath,
        icon: icon || effectiveName.slice(0, 2).toUpperCase(),
        iconColor,
        groupId: effectiveGroupId,
        ...(project ? { imagePath } : { pendingImage }),
        ...(!project &&
        (effectiveKind === "empty" || effectiveKind === "missing" || effectiveKind === "plain")
          ? { scaffoldWorkspace: true }
          : {}),
        ...(!project && effectiveKind === "legacy-claude" ? { prepareWorkspace: true } : {}),
        ...(project ? { worktreeSetupCommand: worktreeSetupCommand.trim() || null } : {}),
        ...(project ? { gitEnabled, private: privateProject } : {}),
      });
    } catch (e: any) {
      const stderr = typeof e?.body?.stderr === "string" ? e.body.stderr.trim() : "";
      const message = e?.message || "Save failed";
      setError(stderr && !message.includes(stderr) ? `${message}\n${stderr}` : message);
    }
  };

  useHotkey("dialog.submit", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "Add project"}
      width={520}
      footer={
        <>
          <EscTooltip label="Cancel">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
          </EscTooltip>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              onClick={submit}
              style={{
                height: 36,
                ["--mc-btn-height" as any]: "36px",
                ["--mc-btn-padding-x" as any]: "18px",
                ["--mc-btn-frame-border" as any]: "14px",
                minWidth: 80,
              }}
            >
              {project ? "Save" : cloning ? "Cloning…" : "Add project"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TextField
          label="Name (optional — defaults to folder name)"
          value={name}
          onChange={setName}
          inputRef={nameRef}
          placeholder={path.trim().split(/[\\/]/).filter(Boolean).pop() || "my-project"}
        />

        {!project && (
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
              Source
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                variant={sourceMode === "folder" ? "solid" : "ghost"}
                icon="folder"
                onClick={() => setSourceMode("folder")}
                aria-pressed={sourceMode === "folder"}
              >
                Open a folder
              </Btn>
              <Btn
                variant={sourceMode === "clone" ? "solid" : "ghost"}
                icon="git-branch"
                onClick={() => setSourceMode("clone")}
                aria-pressed={sourceMode === "clone"}
              >
                Clone a repository
              </Btn>
            </div>
          </div>
        )}

        {!project && sourceMode === "clone" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TextField
              mono
              label="Repository URL"
              value={cloneUrl}
              onChange={setCloneUrl}
              placeholder="https://github.com/you/your-repo.git"
            />
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
                Clone into
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <TextField
                    mono
                    value={cloneParent}
                    onChange={setCloneParent}
                    placeholder="/Users/me/repos"
                  />
                </div>
                <Btn variant="solid" icon="folder" onClick={browseCloneParent}>
                  Browse…
                </Btn>
              </div>
              {cloneRepoName && cloneParent.trim() && (
                <div style={{ marginTop: 6, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-faint)" }}>
                  → {cloneParent.replace(/\/+$/, "")}/{name.trim() || cloneRepoName}
                </div>
              )}
              {gitAvailable === false && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--text-dim)",
                    background: "var(--accent-faint)",
                    border: "1px solid var(--accent-border, var(--border))",
                    borderRadius: 6,
                  }}
                >
                  Git isn&apos;t installed yet — it ships with Apple&apos;s Command
                  Line Tools.
                  <div style={{ marginTop: 8 }}>
                    <Btn variant="solid" icon="terminal" onClick={() => void installGit()}>
                      Install Git
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(project || sourceMode === "folder") && (
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
            Working directory
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                mono
                value={path}
                onChange={setPath}
                placeholder="/Users/me/dev/my-project"
              />
            </div>
            <Btn variant="solid" icon="folder" onClick={browse}>
              Browse…
            </Btn>
          </div>
          {!project && (folderKind === "empty" || folderKind === "missing") && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-dim)",
                background: "var(--accent-faint)",
                border: "1px solid var(--accent-border, var(--border))",
                borderRadius: 6,
              }}
            >
              ✨ New folder — we&apos;ll set it up as a Concourse workspace: starter commands
              (/ask, /doc, workflow builder), a knowledge graph, and integrations config.
            </div>
          )}
          {!project && folderKind === "cwf" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>
              Concourse workspace detected — it&apos;ll be added as-is.
            </div>
          )}
          {!project && folderKind === "plain" && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-dim)",
                background: "var(--accent-faint)",
                border: "1px solid var(--accent-border, var(--border))",
                borderRadius: 6,
              }}
            >
              ✨ Existing folder — we&apos;ll add the standard workspace files (commands,
              knowledge graph, outputs) <b>around</b> your content. Nothing existing is
              modified or moved.
            </div>
          )}
          {!project && folderKind === "legacy-claude" && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-dim)",
                background: "var(--accent-faint)",
                border: "1px solid var(--accent-border, var(--border))",
                borderRadius: 6,
              }}
            >
              🔧 Existing folder — we&apos;ll open a chat that checks it works with Concourse and
              proposes fixes. Each change needs your approval; files are never moved or
              restructured.
            </div>
          )}
        </div>
        )}

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
            Custom image
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="solid" icon="folder" onClick={chooseImage} disabled={uploading}>
              {uploading
                ? "Uploading…"
                : imagePath || pendingImage
                  ? "Replace image…"
                  : "Choose image…"}
            </Btn>
            {(imagePath || pendingImage) && (
              <Btn variant="ghost" onClick={removeImage}>
                Remove
              </Btn>
            )}
            {pendingImage && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {pendingImage.sourcePath.split(/[\\/]/).pop()} — uploads on save
              </span>
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-faint)",
              }}
            >
              PNG / JPG / WebP / GIF, ≤ 5MB
            </span>
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
            Icon (fallback)
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              placeholder="AB"
              style={{
                width: 60,
                textAlign: "center",
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                outline: 0,
                color: "var(--text)",
                padding: "9px 8px",
                fontFamily: "var(--mono)",
                fontSize: 14,
                fontWeight: 600,
              }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ICON_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setIconColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: c,
                    border: iconColor === c ? "2px solid var(--text)" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
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
            Group
          </label>
          <div style={{ position: "relative" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface-0)",
                border: `1px solid ${groupTypeaheadOpen ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 7,
                padding: "0 8px 0 12px",
                minHeight: 38,
              }}
            >
              {selectedGroup && (
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: selectedGroup.color,
                    flex: "0 0 auto",
                  }}
                />
              )}
              <input
                value={groupQuery}
                onFocus={() => setGroupTypeaheadOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setGroupTypeaheadOpen(false), 100);
                }}
                onChange={(e) => {
                  const next = e.target.value;
                  setGroupQuery(next);
                  setGroupTypeaheadOpen(true);
                  if (!next.trim()) setGroupId("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitGroupQuery();
                  } else if (e.key === "Escape") {
                    setGroupTypeaheadOpen(false);
                  }
                }}
                role="combobox"
                aria-expanded={groupTypeaheadOpen}
                aria-controls="project-group-options"
                aria-label="Project group"
                placeholder="Ungrouped or group name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  color: "var(--text)",
                  padding: "9px 0",
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                }}
              />
              {(groupQuery || groupId) && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearGroup}
                  aria-label="Clear group"
                  title="Clear group"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    border: 0,
                    background: "transparent",
                    color: "var(--text-faint)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            {groupTypeaheadOpen && (
              <div
                id="project-group-options"
                role="listbox"
                style={{
                  position: "absolute",
                  zIndex: 20,
                  left: 0,
                  right: 0,
                  top: "calc(100% + 6px)",
                  maxHeight: 220,
                  overflow: "auto",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 14px 36px rgba(0, 0, 0, 0.32)",
                  padding: 6,
                }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={groupId === ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearGroup}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    border: 0,
                    borderRadius: 6,
                    background: groupId === "" ? "var(--accent-dim)" : "transparent",
                    color: groupId === "" ? "var(--accent)" : "var(--text-dim)",
                    cursor: "pointer",
                    padding: "7px 9px",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                  }}
                >
                  Ungrouped
                </button>
                {filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    role="option"
                    aria-selected={groupId === group.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectGroup(group)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      border: 0,
                      borderRadius: 6,
                      background: groupId === group.id ? "var(--accent-dim)" : "transparent",
                      color: groupId === group.id ? "var(--accent)" : "var(--text)",
                      cursor: "pointer",
                      padding: "7px 9px",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: group.color,
                      }}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {group.name}
                    </span>
                  </button>
                ))}
                {canCreateGroup && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={creatingGroup}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitGroupQuery()}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      border: 0,
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--accent)",
                      cursor: creatingGroup ? "default" : "pointer",
                      opacity: creatingGroup ? 0.65 : 1,
                      padding: "7px 9px",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  >
                    <Icon name="plus" size={12} />
                    {creatingGroup ? "Creating..." : `Create "${groupQuery.trim()}"`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {project && (
          <TextField
            mono
            label="New worktree setup command"
            value={worktreeSetupCommand}
            onChange={(value) => setWorktreeSetupCommand(value.slice(0, 500))}
            placeholder="pnpm i"
            hint="Optional. Runs once inside each newly created worktree."
          />
        )}

        {project && (
          <ToggleRow
            title="Version control"
            description="Show Ship, branch status, and the diff/review view. Turn off for business workspaces whose output is Jira/Confluence, not code."
            label="Version control"
            checked={gitEnabled}
            onChange={setGitEnabled}
          />
        )}

        {project && (
          <ToggleRow
            title="Private project"
            description="Sessions here can read and cite org knowledge, but never write to it — everything learned stays in this project. For personal or sensitive work that shouldn't feed the shared brain by accident."
            label="Private project"
            checked={privateProject}
            onChange={setPrivateProject}
          />
        )}

        {project && (onOpenLaunchCommands || onOpenCustomScripts) && (
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
              Advanced
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onOpenLaunchCommands && (
                <Btn variant="ghost" icon="play" onClick={onOpenLaunchCommands}>
                  Launch commands
                </Btn>
              )}
              {onOpenCustomScripts && (
                <Btn variant="ghost" icon="terminal" onClick={onOpenCustomScripts}>
                  Custom scripts
                </Btn>
              )}
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
