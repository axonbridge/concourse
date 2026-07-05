import { useMemo, type CSSProperties } from "react";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { Icon } from "~/components/ui/Icon";
import { parserForFilename } from "~/lib/file-language";
import type { GitDiff } from "~/server/services/git";

export function DiffPane({
  diff,
  loading,
  error,
  filePath,
}: {
  diff: GitDiff | undefined;
  loading: boolean;
  error: string | null;
  filePath: string | null;
}) {
  if (!filePath) {
    return (
      <Centered>
        <Icon name="git-branch" size={32} style={{ color: "var(--text-faint)" }} />
        <div style={{ marginTop: 12, color: "var(--text-dim)", fontSize: 13 }}>
          Select a file to view its diff.
        </div>
      </Centered>
    );
  }
  if (loading && !diff) {
    return <Centered><Muted>Loading diff…</Muted></Centered>;
  }
  if (error) {
    return (
      <Centered>
        <div style={{ color: "var(--status-failed)", fontFamily: "var(--mono)", fontSize: 12 }}>
          {error}
        </div>
      </Centered>
    );
  }
  if (!diff) return null;
  if (diff.kind === "empty") {
    return <Centered><Muted>No changes for this file.</Muted></Centered>;
  }
  if (diff.kind === "binary") {
    return <Centered><Muted>Binary file — diff not shown.</Muted></Centered>;
  }
  if (diff.kind === "too-large") {
    return (
      <Centered>
        <Muted>
          Diff too large to display ({diff.lines.toLocaleString()} lines,{" "}
          {(diff.bytes / 1024).toFixed(0)} KB).
        </Muted>
      </Centered>
    );
  }
  return <DiffText patch={diff.patch} filePath={filePath} />;
}

/** Tokenize `code` with a Lezer parser and return one array of styled spans
 *  per line. Falls back to plain lines if the parser chokes. */
function highlightToLines(code: string, parser: Parser): React.ReactNode[][] {
  const lines: React.ReactNode[][] = [[]];
  let key = 0;
  try {
    highlightCode(
      code,
      parser.parse(code),
      classHighlighter,
      (text, classes) => {
        lines[lines.length - 1].push(
          classes ? (
            <span key={key++} className={classes}>
              {text}
            </span>
          ) : (
            text
          ),
        );
      },
      () => lines.push([]),
    );
  } catch {
    return code.split("\n").map((l) => [l]);
  }
  return lines;
}

/**
 * Syntax-colored patch lines. Each hunk is highlighted as two contiguous
 * blocks — old (context + deletions) and new (context + additions) — so
 * multi-line constructs keep their colors; per-line parsing would break
 * strings and JSX that span lines.
 */
function useHighlightedLines(patch: string, filePath: string | null): React.ReactNode[] {
  return useMemo(() => {
    const lines = patch.split("\n");
    const parser = filePath ? parserForFilename(filePath) : null;
    const rendered: React.ReactNode[] = lines.map((l) => l || " ");
    if (!parser) return rendered;

    let i = 0;
    while (i < lines.length) {
      if (!lines[i].startsWith("@@")) {
        i++;
        continue;
      }
      const start = ++i;
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
        i++;
      }
      const oldSrc: string[] = [];
      const newSrc: string[] = [];
      const oldRows: (number | null)[] = [];
      const newRows: (number | null)[] = [];
      for (let row = start; row < i; row++) {
        const line = lines[row];
        const c = line[0];
        if (c === "\\") continue; // "\ No newline at end of file"
        const body = line.slice(1);
        if (c === "-") {
          oldSrc.push(body);
          oldRows.push(row);
        } else if (c === "+") {
          newSrc.push(body);
          newRows.push(row);
        } else {
          // Context lines feed both parses; render from the new pass.
          oldSrc.push(body);
          oldRows.push(null);
          newSrc.push(body);
          newRows.push(row);
        }
      }
      const oldHl = highlightToLines(oldSrc.join("\n"), parser);
      const newHl = highlightToLines(newSrc.join("\n"), parser);
      oldRows.forEach((row, k) => {
        if (row === null || !oldHl[k]) return;
        rendered[row] = (
          <>
            {"-"}
            {oldHl[k]}
          </>
        );
      });
      newRows.forEach((row, k) => {
        if (row === null || !newHl[k]) return;
        rendered[row] = (
          <>
            {lines[row][0] ?? " "}
            {newHl[k]}
          </>
        );
      });
    }
    return rendered;
  }, [patch, filePath]);
}

function DiffText({ patch, filePath }: { patch: string; filePath: string | null }) {
  const lines = patch.split("\n");
  const highlighted = useHighlightedLines(patch, filePath);
  return (
    <pre
      className="mc-diff-code"
      style={{
        flex: 1,
        margin: 0,
        padding: 0,
        overflow: "auto",
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: 1.5,
        background: "transparent",
        color: "var(--text)",
        whiteSpace: "pre",
        tabSize: 2,
      }}
    >
      {lines.map((line, i) => {
        const style = lineStyle(line);
        return (
          <div
            key={i}
            style={{
              display: "block",
              padding: "0 12px",
              ...style,
            }}
          >
            {highlighted[i]}
          </div>
        );
      })}
    </pre>
  );
}

function lineStyle(line: string): CSSProperties {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return { color: "var(--text-dim)", fontWeight: 600 };
  }
  if (line.startsWith("@@")) {
    return {
      color: "var(--accent, #6cd07e)",
      background: "var(--surface-1)",
    };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("rename ") || line.startsWith("similarity ") || line.startsWith("Binary ")) {
    return { color: "var(--text-faint)" };
  }
  if (line.startsWith("+")) {
    return { background: "rgba(108, 208, 126, 0.12)", color: "var(--text)" };
  }
  if (line.startsWith("-")) {
    return { background: "rgba(224, 107, 107, 0.12)", color: "var(--text)" };
  }
  return {};
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        padding: 32,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
      {children}
    </div>
  );
}
