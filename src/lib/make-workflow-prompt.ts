// The chat-menu "Make workflow" action: the conversation the user just had IS
// the interview — extract the repeatable process from it instead of asking
// the questions /create-workflow would ask from scratch.

export const MAKE_WORKFLOW_DISPLAY_TEXT = "Turn this conversation into a reusable workflow";

export function buildMakeWorkflowPrompt(): string {
  return `The user wants to turn THIS conversation's task into a reusable workflow for this workspace.

1. Use THIS conversation as the interview: extract the goal, the inputs the user supplied, the steps that actually worked (skip dead ends and one-off corrections), and the output format of the final deliverable. If commands/create-workflow.md exists, follow its house format.
2. Create the files where this project keeps its commands (commands/ in a Concourse workspace; .claude/commands/ in a code repo):
   - commands/<slug>.md — frontmatter: description (one line a teammate will recognize), examples (2-3 derived from what the user actually asked), custom: true, owns: listing any agents/skills you create, template: <slug> when you create an output template.
   - Factor genuinely reusable specialist steps into agents/, durable conventions into skills/, and the deliverable's format into templates/ — only when they earn their keep; a single well-written command file is often enough.
3. Name it after the TASK (e.g. sprint-status), not the conversation. Plain markdown + YAML frontmatter only; never write machine-absolute paths into the files.
4. Include the knowledge-first section if the workflow reads external systems (check knowledge facts before fetching, save durable discoveries back).
5. Reply with the command name and a one-line usage example — it appears in the command picker immediately.

Each file write goes through the normal approval. Do not ask interview questions the conversation already answers; only ask if something essential is genuinely missing.`;
}
