import { loadWorkspace } from "./fs-loader";

// Engines with no native slash-command mechanism (Codex, Cursor) get commands
// resolved BY THE APP from the provider-neutral CWF source — the same
// "files are the contract; engines are visitors" rule the Direct engine
// follows in its system prompt. Harness engines (Claude, OpenCode) keep using
// their projected slash files; this module is for the coarse harnesses only.

/**
 * Expand a leading `/command` into its full CWF instructions: the command
 * body (with `$ARGUMENTS` substituted), owned agents folded in as
 * "you perform this role yourself", owned skills, and the output template.
 * Text that doesn't start with a known command passes through unchanged.
 */
export function inlineSlashCommand(cwd: string, text: string): string {
  const match = text.trim().match(/^\/([\w-]+)\s*([\s\S]*)$/);
  if (!match) return text;
  let ws: ReturnType<typeof loadWorkspace>;
  try {
    ws = loadWorkspace(cwd);
  } catch {
    return text;
  }
  const cmd = ws.commands.find((c) => c.slug === match[1]);
  if (!cmd) return text;

  const args = match[2].trim();
  let body = cmd.body.trim();
  const hasArgsPlaceholder = body.includes("$ARGUMENTS");
  if (hasArgsPlaceholder) body = body.split("$ARGUMENTS").join(args);

  const parts = [`Follow this command's instructions (/${cmd.slug}):`, body];
  for (const slug of cmd.owns.agents) {
    const agent = ws.agents.find((a) => a.slug === slug);
    if (agent) {
      parts.push(
        `## Sub-agent instructions: ${slug}\n\n(You perform this role yourself.)\n\n${agent.body.trim()}`,
      );
    }
  }
  for (const slug of cmd.owns.skills) {
    const skill = ws.skills.find((s) => s.slug === slug);
    if (skill) parts.push(`## Skill: ${slug}\n\n${skill.body.trim()}`);
  }
  if (cmd.template) {
    const tpl = ws.templates.find((t) => t.slug === cmd.template);
    if (tpl) parts.push(`## Output template\n\nProduce the output exactly following:\n\n${tpl.body.trim()}`);
  }
  if (!hasArgsPlaceholder && args) parts.push(`## User request\n\n${args}`);
  return parts.join("\n\n");
}
