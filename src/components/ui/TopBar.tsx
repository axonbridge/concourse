import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type Crumb = { label: string; onClick?: () => void; node?: ReactNode };

export function TopBar({
  crumbs,
  right,
  onHome,
  leading,
  centerActions,
  leadingInset,
}: {
  crumbs?: Crumb[];
  right?: ReactNode;
  onHome?: () => void;
  leading?: ReactNode;
  centerActions?: ReactNode;
  leadingInset?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        padding: `0 20px 0 ${leadingInset ?? 24}px`,
        background: "transparent",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        pointerEvents: "auto",
        // The bar itself is NOT a drag region — `-webkit-app-region: drag`
        // swallows clicks on macOS even for no-drag children. Instead we put a
        // dedicated drag layer *behind* the contents (below) and keep every
        // interactive element above it in a clean no-drag layer.
        ["WebkitAppRegion" as any]: "no-drag",
      }}
    >
      {/* Window-drag layer — sits behind the bar contents so empty areas still
          drag the window, while logo/breadcrumbs/buttons stay clickable. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          ["WebkitAppRegion" as any]: "drag",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <button
          type="button"
          onClick={onHome}
          aria-label="All projects"
          title="All projects"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            color: "inherit",
            pointerEvents: "auto",
            ["WebkitAppRegion" as any]: "no-drag",
          }}
        >
          <img
            src="/images/concourse-logo.png"
            alt="Concourse"
            width={26}
            height={26}
            // `-webkit-app-region` does not inherit reliably in Electron, so the
            // image inside a drag-region topbar can swallow the click as a window
            // drag. Pin it no-drag + pointer-events so the logo always navigates.
            style={{
              display: "block",
              pointerEvents: "auto",
              ["WebkitAppRegion" as any]: "no-drag",
            }}
          />
        </button>
        {leading && (
          <>
            <span
              aria-hidden
              style={{
                width: 1,
                height: 18,
                background: "var(--border-strong)",
              }}
            />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                pointerEvents: "auto",
                ["WebkitAppRegion" as any]: "no-drag",
              }}
            >
              {leading}
            </span>
          </>
        )}
        {crumbs && crumbs.length > 0 && (
          <>
            <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {i > 0 && (
                  <Icon name="chevron-right" size={11} style={{ color: "var(--text-faint)" }} />
                )}
                {c.node ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      pointerEvents: "auto",
                      ["WebkitAppRegion" as any]: "no-drag",
                    }}
                  >
                    {c.node}
                  </span>
                ) : (
                  <span
                    onClick={c.onClick}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: i === crumbs.length - 1 ? "var(--text)" : "var(--text-dim)",
                      cursor: c.onClick ? "pointer" : "default",
                      pointerEvents: c.onClick ? "auto" : undefined,
                      ["WebkitAppRegion" as any]: c.onClick ? "no-drag" : undefined,
                    }}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </>
        )}
        {centerActions && (
          <span
            aria-hidden
            style={{
              width: 1,
              height: 18,
              background: "var(--border)",
              margin: "0 4px",
            }}
          />
        )}
        {centerActions && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              pointerEvents: "auto",
              ["WebkitAppRegion" as any]: "no-drag",
            }}
          >
            {centerActions}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "auto",
          position: "relative",
          zIndex: 1,
          ["WebkitAppRegion" as any]: "no-drag",
        }}
      >
        {right}
      </div>
    </div>
  );
}
