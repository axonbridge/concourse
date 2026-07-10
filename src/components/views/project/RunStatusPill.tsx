import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { Z_INDEX } from "~/lib/z-index";

export function RunStatusPill({
  running,
  launching,
  stopping,
  disabled = false,
  disabledLabel = "Unavailable",
  launchUrl,
  onStart,
  onOpenUrl,
  onStop,
  onEdit,
}: {
  running: boolean;
  launching: boolean;
  stopping: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  launchUrl: string | null;
  onStart: () => void;
  onOpenUrl: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (groupRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleMenu = () => {
    const rect = groupRef.current?.getBoundingClientRect();
    if (rect) setMenuRect({ top: rect.bottom + 6, left: rect.left });
    setMenuOpen((v) => !v);
  };
  const busy = launching || stopping;
  const label = disabled
    ? disabledLabel
    : stopping
    ? "Stopping…"
    : launching
      ? "Starting…"
      : running
        ? "Running"
        : "Offline";

  const interactive = !disabled && !busy && !running;
  const onClick = disabled || busy ? undefined : running ? undefined : onStart;

  const title = disabled
    ? disabledLabel
    : busy
    ? label
    : running
      ? "Running"
      : "Run launch commands";

  const tone = !disabled && (running || launching) ? "active" : "idle";
  const dotColor = tone === "active" ? "var(--accent)" : "var(--text-faint)";
  const borderColor = tone === "active" ? "var(--accent-border)" : "var(--border)";
  const background = tone === "active" ? "var(--accent-faint)" : "var(--surface-0)";
  const fg = tone === "active" ? "var(--accent)" : "var(--text-dim)";

  const activeFrameIconStyle: CSSProperties = {
    width: 52,
    minWidth: 52,
    paddingInline: 0,
    fontFamily: "var(--mono)",
  };

  const showRunningSplit = running && !busy;

  if (showRunningSplit) {
    return (
      <div
        role="group"
        aria-label="Project launch — running"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <HotkeyTooltip action="project.runToggle" label="Stop launch commands">
          <Btn
            variant="danger"
            icon="stop"
            onClick={() => onStop()}
            aria-label="Stop launch commands"
            style={activeFrameIconStyle}
          />
        </HotkeyTooltip>
        {launchUrl ? (
          <Btn
            variant="ghost"
            icon="globe"
            onClick={onOpenUrl}
            title={`Open ${launchUrl} in browser`}
            aria-label={`Open ${launchUrl} in browser`}
            style={activeFrameIconStyle}
          />
        ) : null}
      </div>
    );
  }

  if (!running && !busy) {
    return (
      <div
        ref={groupRef}
        role="group"
        aria-label="Project launch"
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <HotkeyTooltip action="project.runToggle" label={title}>
          <Btn
            variant="ghost"
            icon="play"
            onClick={disabled ? undefined : onStart}
            disabled={disabled}
            aria-label={title}
            style={{ ...activeFrameIconStyle, width: 36, minWidth: 36 }}
          />
        </HotkeyTooltip>
        <Btn
          variant="ghost"
          icon="chevron-down"
          onClick={disabled ? undefined : toggleMenu}
          disabled={disabled}
          aria-label="Launch command options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{ width: 22, minWidth: 22, paddingInline: 0 }}
        />
        {menuOpen &&
          menuRect &&
          createPortal(
            <CardFrame
              ref={menuRef}
              role="menu"
              solid
              style={{
                position: "fixed",
                top: menuRect.top,
                left: menuRect.left,
                minWidth: 220,
                boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
                zIndex: Z_INDEX.popover,
              }}
            >
              <DropdownMenuItem
                icon="play"
                onClick={() => {
                  setMenuOpen(false);
                  onStart();
                }}
              >
                Run launch commands
              </DropdownMenuItem>
              <DropdownMenuItem
                icon="settings"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                Edit launch commands…
              </DropdownMenuItem>
            </CardFrame>,
            document.body,
          )}
      </div>
    );
  }

  return (
    <HotkeyTooltip action="project.runToggle" label={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={!interactive}
        aria-label={title}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 28,
          padding: "0 12px",
          borderRadius: 999,
          border: `1px solid ${borderColor}`,
          background,
          color: fg,
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          fontWeight: 600,
          cursor: interactive ? "pointer" : "default",
          opacity: busy ? 0.7 : 1,
          transition: "background 0.12s, border-color 0.12s, color 0.12s",
          boxShadow: running ? "0 0 8px var(--accent-glow)" : "none",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: running ? "0 0 6px var(--accent-glow)" : "none",
            animation: launching || stopping ? "pulse-border 1.4s ease-in-out infinite" : "none",
          }}
        />
        <span>{label}</span>
      </button>
    </HotkeyTooltip>
  );
}
