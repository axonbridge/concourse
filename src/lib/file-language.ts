import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { Language, LanguageSupport, StreamLanguage } from "@codemirror/language";
import type { Parser } from "@lezer/common";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { sql } from "@codemirror/legacy-modes/mode/sql";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import type { Extension } from "@uiw/react-codemirror";

const envLanguage = StreamLanguage.define({
  name: "dotenv",
  token(stream) {
    if (stream.sol() && stream.match(/#.*/)) return "comment";
    if (stream.sol() && stream.match(/[A-Za-z_][A-Za-z0-9_]*(?==)/)) return "variableName";
    if (stream.match("=")) return "operator";
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.next() == null) return null;
    return null;
  },
});

export function languageForFilename(name: string): Extension[] {
  const lower = name.toLowerCase();
  const base = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";

  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) {
    return [envLanguage];
  }
  if (ext === "json" || ext === "jsonc" || base === ".babelrc" || base === ".eslintrc") {
    return [json()];
  }
  if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") {
    return [javascript({ typescript: true, jsx: ext === "tsx" })];
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return [javascript({ jsx: ext === "jsx" })];
  }
  if (ext === "css" || ext === "scss" || ext === "less") return [css()];
  if (ext === "html" || ext === "htm" || ext === "vue" || ext === "svelte") return [html()];
  if (ext === "md" || ext === "mdx" || ext === "markdown") return [markdown()];
  if (ext === "py" || ext === "pyi") return [python()];
  if (ext === "yml" || ext === "yaml") return [yaml()];
  if (ext === "sh" || ext === "bash" || ext === "zsh" || base === ".zshrc" || base === ".bashrc" || base === ".zprofile") {
    return [StreamLanguage.define(shell)];
  }
  if (ext === "toml" || base === "cargo.lock") return [StreamLanguage.define(toml)];
  if (ext === "rs") return [StreamLanguage.define(rust)];
  if (ext === "go") return [StreamLanguage.define(go)];
  if (ext === "rb" || base === "gemfile" || base === "rakefile") return [StreamLanguage.define(ruby)];
  if (ext === "swift") return [StreamLanguage.define(swift)];
  if (ext === "sql") return [StreamLanguage.define(sql({}))];
  if (ext === "xml" || ext === "svg" || ext === "plist") return [StreamLanguage.define(xml)];
  return [];
}

/** The bare Lezer parser for a filename, for highlighting outside an editor
 *  (e.g. diff panes). Null when the language is unknown. */
export function parserForFilename(name: string): Parser | null {
  const first = languageForFilename(name)[0];
  if (!first) return null;
  if (first instanceof LanguageSupport) return first.language.parser;
  if (first instanceof Language) return first.parser;
  return null;
}
