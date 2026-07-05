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

// Shared code-editor behavior for every CodeMirror surface in the app:
// depth-colored "rainbow" brackets, matching-bracket highlight, and a
// jump-to-matching-bracket keybinding for moving around deeply nested code.

const RAINBOW_DEPTHS = 6;

const rainbowTheme = EditorView.baseTheme({
  ".cm-rb-0": { color: "#ffd700" },
  ".cm-rb-1": { color: "#da70d6" },
  ".cm-rb-2": { color: "#57b6ff" },
  ".cm-rb-3": { color: "#5fd7a7" },
  ".cm-rb-4": { color: "#ff8f5f" },
  ".cm-rb-5": { color: "#ff6b9d" },
  ".cm-rb-err": { color: "#ff5555", fontWeight: "bold" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    outline: "1px solid rgba(255, 255, 255, 0.25)",
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
