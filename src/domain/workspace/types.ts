// Concourse Workspace Format (CWF) — the provider-neutral, OKF-aligned file
// contract. Every item is markdown + YAML frontmatter; its id is its path;
// links are graph edges. Engines are visitors: the Claude projector emits
// `.claude/` from this model; the Direct engine assembles prompts from it.
//
// Domain purity: this module (and parse.ts) have ZERO node/electron/react
// imports. Filesystem access lives in fs-loader.ts.

export const CWF_ITEM_TYPES = [
  "workspace",
  "command",
  "agent",
  "skill",
  "template",
  "knowledge",
] as const;
export type CwfItemType = (typeof CWF_ITEM_TYPES)[number];

/** Directory (relative to the workspace root) for each item type. */
export const CWF_DIRS: Record<Exclude<CwfItemType, "workspace">, string> = {
  command: "commands",
  agent: "agents",
  skill: "skills",
  template: "templates",
  knowledge: "knowledge",
};

/** The single entry-point file an engine is pointed at. */
export const CWF_ENTRY_FILE = "workspace.md";

/** Standard MCP config declaring the integrations a workspace needs. */
export const CWF_MCP_FILE = ".mcp.json";

export type CwfFrontmatter = Record<string, string | string[] | boolean>;

export type CwfItem = {
  /** OKF concept id: workspace-relative path without the .md extension. */
  id: string;
  type: CwfItemType;
  /** File name without extension (e.g. "weekly-summary"). */
  slug: string;
  title: string;
  description: string;
  /** Raw frontmatter — unknown keys preserved (OKF round-trip rule). */
  frontmatter: CwfFrontmatter;
  /** Markdown body (after the frontmatter fence). */
  body: string;
  /** Absolute file path on disk. */
  filePath: string;
};

export type CwfCommand = CwfItem & {
  type: "command";
  examples: string[];
  /** User-created workflow (deletable/sharable/editable from the UI). */
  custom: boolean;
  /** Agent/skill slugs this command owns (delete/share follow these). */
  owns: { agents: string[]; skills: string[] };
  /** Slug of the output template it follows (templates/<slug>.md). */
  template?: string;
  /** Emoji icon override. */
  icon?: string;
};

export type CwfWorkspace = {
  dir: string;
  /** workspace.md — null when the dir is not a CWF workspace. */
  workspace: CwfItem | null;
  commands: CwfCommand[];
  agents: CwfItem[];
  skills: CwfItem[];
  templates: CwfItem[];
};
