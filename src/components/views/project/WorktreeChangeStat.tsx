export function WorktreeChangeStat({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface-0)",
        padding: "9px 10px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 16,
          fontWeight: 650,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </div>
    </div>
  );
}
