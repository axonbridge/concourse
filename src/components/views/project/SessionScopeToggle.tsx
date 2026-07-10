import { useRef, type CSSProperties } from "react";
import { Icon } from "~/components/ui/Icon";
import type { SessionView } from "./helpers";

export function SessionScopeToggle({
  view,
  activeCount,
  pinnedCount,
  archivedCount,
  showArchivedTab,
  onChange,
}: {
  view: SessionView;
  activeCount: number;
  pinnedCount: number;
  archivedCount: number;
  showArchivedTab: boolean;
  onChange: (view: SessionView) => void;
}) {
  const segment = (selected: boolean): CSSProperties => ({
    appearance: "none",
    border: 0,
    background: selected ? "var(--surface-2)" : "transparent",
    color: selected ? "var(--text)" : "var(--text-dim)",
    fontFamily: "var(--mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    padding: "5px 12px",
    borderRadius: 7,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    boxShadow: selected
      ? "inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.3)"
      : "none",
  });
  const countStyle: CSSProperties = {
    color: "var(--text-faint)",
    fontVariantNumeric: "tabular-nums",
  };
  const tabs: Array<{ view: SessionView; label: string; count: number; icon: "terminal" | "pin-fill" | "archive" }> = [
    { view: "active", label: "Active", count: activeCount, icon: "terminal" },
    { view: "pinned", label: "Pinned", count: pinnedCount, icon: "pin-fill" },
  ];
  if (showArchivedTab) {
    tabs.push({ view: "archived", label: "Archived", count: archivedCount, icon: "archive" });
  }
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectTabAt = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.view);
    requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };
  return (
    <div
      role="radiogroup"
      aria-label="Show sessions by type"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 9,
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
      }}
    >
      {tabs.map((tab) => {
        const selected = view === tab.view;
        const tabIndex = tabs.findIndex((entry) => entry.view === tab.view);
        return (
          <button
            key={tab.view}
            ref={(node) => {
              tabRefs.current[tabIndex] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            style={segment(selected)}
            onClick={() => onChange(tab.view)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                selectTabAt((tabIndex + 1) % tabs.length);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                selectTabAt((tabIndex - 1 + tabs.length) % tabs.length);
              } else if (e.key === "Home") {
                e.preventDefault();
                selectTabAt(0);
              } else if (e.key === "End") {
                e.preventDefault();
                selectTabAt(tabs.length - 1);
              }
            }}
          >
            <Icon name={tab.icon} size={13} />
            {tab.label}
            <span style={countStyle}>{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}
