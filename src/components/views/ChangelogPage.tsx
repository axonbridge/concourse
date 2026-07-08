import { useMemo } from "react";
import { Markdown } from "~/components/ui/Markdown";
import { SettingsSection } from "~/components/views/SettingsParts";
// Baked in at build time so the page always describes exactly this binary.
import changelogRaw from "../../../CHANGELOG.md?raw";

// Newest-first version sections, capped so a long history doesn't bloat the
// page — people care about what just changed, not archaeology.
const MAX_VERSIONS = 15;

type VersionSection = { heading: string; body: string };

function parseChangelog(raw: string): VersionSection[] {
  const sections: VersionSection[] = [];
  const parts = raw.split(/^## /m).slice(1); // drop the file preamble
  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    sections.push({ heading: part.slice(0, nl).trim(), body: part.slice(nl + 1).trim() });
  }
  return sections.slice(0, MAX_VERSIONS);
}

export function ChangelogPage() {
  const sections = useMemo(() => parseChangelog(changelogRaw), []);
  return (
    <SettingsSection
      title="What's new"
      subtitle={`Release notes for this build${sections[0] ? ` — you're on ${sections[0].heading.split(" ")[0]}` : ""}.`}
      headingLevel="h1"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 760 }}>
        {sections.map((s, i) => (
          <div key={s.heading}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                paddingBottom: 6,
                borderBottom: "1px solid var(--border)",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>{s.heading}</span>
              {i === 0 && (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                    border: "1px solid var(--accent-border, var(--border))",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  Current
                </span>
              )}
            </div>
            <Markdown>{s.body}</Markdown>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
