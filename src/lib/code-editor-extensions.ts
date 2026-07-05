import { useSyncExternalStore } from "react";
import {
  Decoration,
  EditorView,
  RangeSetBuilder,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type Extension,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { cursorMatchingBracket } from "@codemirror/commands";
import { catppuccinLatte, catppuccinMocha } from "@catppuccin/codemirror";
import {
  getConcourseColorScheme,
  watchConcourseColorScheme,
  type ConcourseColorScheme,
} from "~/lib/mermaid-theme";

// Shared code-editor behavior for every CodeMirror surface in the app:
// depth-colored "rainbow" brackets, matching-bracket highlight, and a
// jump-to-matching-bracket keybinding for moving around deeply nested code.
// Editors follow the app theme with the Catppuccin palette — Mocha when
// dark, Latte when light (https://github.com/catppuccin/palette).

const RAINBOW_DEPTHS = 6;

// Rainbow colors from the Catppuccin palette: yellow, mauve, sapphire,
// green, peach, red — Mocha shades under `&dark`, Latte under `&light`
// (CodeMirror picks the block from the active theme's dark flag).
const rainbowTheme = EditorView.baseTheme({
  "&dark .cm-rb-0": { color: "#f9e2af" },
  "&dark .cm-rb-1": { color: "#cba6f7" },
  "&dark .cm-rb-2": { color: "#74c7ec" },
  "&dark .cm-rb-3": { color: "#a6e3a1" },
  "&dark .cm-rb-4": { color: "#fab387" },
  "&dark .cm-rb-5": { color: "#f38ba8" },
  "&dark .cm-rb-err": { color: "#f38ba8", fontWeight: "bold", textDecoration: "underline" },
  "&light .cm-rb-0": { color: "#df8e1d" },
  "&light .cm-rb-1": { color: "#8839ef" },
  "&light .cm-rb-2": { color: "#209fb5" },
  "&light .cm-rb-3": { color: "#40a02b" },
  "&light .cm-rb-4": { color: "#fe640b" },
  "&light .cm-rb-5": { color: "#d20f39" },
  "&light .cm-rb-err": { color: "#d20f39", fontWeight: "bold", textDecoration: "underline" },
  "&dark.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    outline: "1px solid rgba(255, 255, 255, 0.25)",
  },
  "&light.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(0, 0, 0, 0.10)",
    outline: "1px solid rgba(0, 0, 0, 0.22)",
  },
});

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE = new Set([")", "]", "}"]);

/** True when the position sits inside a string/comment/regexp token, where a
 *  bracket character is content, not structure. */
function insideNonCode(view: EditorView, pos: number): boolean {
  const node = syntaxTree(view.state).resolveInner(pos + 1, -1);
  return /string|comment|regexp|template/i.test(node.name);
}

function computeRainbow(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const hasTree = syntaxTree(view.state).length > 0;
  const ranges = view.visibleRanges;
  if (ranges.length === 0) return builder.finish();
  const end = ranges[ranges.length - 1].to;
  const visible = (pos: number) => ranges.some((r) => pos >= r.from && pos < r.to);

  // Depth is seeded from the document start so colors stay stable while
  // scrolling. Outside the viewport brackets are counted with a cheap char
  // scan; the syntax-tree check (strings/comments) only runs where we
  // actually decorate.
  const stack: string[] = [];
  const text = view.state.sliceDoc(0, end);
  for (let pos = 0; pos < end; pos++) {
    const ch = text[pos];
    const isOpen = ch in OPEN;
    if (!isOpen && !CLOSE.has(ch)) continue;
    const inView = visible(pos);
    if (inView && hasTree && insideNonCode(view, pos)) continue;
    if (isOpen) {
      if (inView) {
        builder.add(pos, pos + 1, Decoration.mark({ class: `cm-rb-${stack.length % RAINBOW_DEPTHS}` }));
      }
      stack.push(OPEN[ch]);
      continue;
    }
    const expected = stack.pop();
    if (!inView) continue;
    builder.add(
      pos,
      pos + 1,
      expected === ch
        ? Decoration.mark({ class: `cm-rb-${stack.length % RAINBOW_DEPTHS}` })
        : Decoration.mark({ class: "cm-rb-err" }),
    );
  }
  return builder.finish();
}

const rainbowPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeRainbow(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = computeRainbow(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function rainbowBrackets(): Extension {
  return [rainbowTheme, rainbowPlugin];
}

/** Alt-M (and Cmd-Shift-\ like VS Code): jump between a bracket and its match. */
const bracketNavKeymap = keymap.of([
  { key: "Alt-m", run: cursorMatchingBracket },
  { key: "Mod-Shift-\\", run: cursorMatchingBracket },
]);

export function codeEditorExtensions(): Extension[] {
  return [rainbowBrackets(), bracketMatching(), bracketNavKeymap];
}

// Catppuccin editor chrome per app theme. `background` is for the container
// around the editor so scrollbars/empty space match the flavor's base color.
const EDITOR_THEMES: Record<
  ConcourseColorScheme,
  { theme: Extension; background: string }
> = {
  dark: { theme: catppuccinMocha, background: "#1e1e2e" },
  light: { theme: catppuccinLatte, background: "#eff1f5" },
};

function subscribeColorScheme(onChange: () => void): () => void {
  return watchConcourseColorScheme(onChange);
}

/** The app's light/dark scheme, reactive to the theme toggle. */
export function useAppColorScheme(): ConcourseColorScheme {
  return useSyncExternalStore(
    subscribeColorScheme,
    getConcourseColorScheme,
    () => "dark" as const,
  );
}

/** Catppuccin CodeMirror theme (Mocha/Latte) matching the app theme. */
export function useEditorTheme(): { theme: Extension; background: string } {
  return EDITOR_THEMES[useAppColorScheme()];
}
