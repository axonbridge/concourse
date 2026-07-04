// Capability-classed action policy — the domain's approval rules, independent of
// any vendor's tool vocabulary. Each engine adapter maps its native tool names
// to an ActionClass; this policy decides allow/ask. The renderer's Approve/Deny
// card is the "ask" surface. See docs/ARCHITECTURE.md §1/§4.

export type ActionClass =
  | "read" // local, side-effect-free: files, search, planning
  | "external-read" // remote reads: Jira/Confluence queries, web search
  | "write" // local file mutations
  | "external-write" // remote mutations: create Jira issue, publish page
  | "execute"; // shell / arbitrary commands

export type ActionDecision = "allow" | "ask";

export type ActionPolicyConfig = {
  /** The workflow-builder flow: local file writes flow without per-file cards.
   *  Scoped to `write` only — execute and external writes still gate. */
  autoApproveWrites?: boolean;
};

export function decideAction(cls: ActionClass, cfg: ActionPolicyConfig = {}): ActionDecision {
  switch (cls) {
    case "read":
    case "external-read":
      return "allow";
    case "write":
      return cfg.autoApproveWrites ? "allow" : "ask";
    case "external-write":
    case "execute":
      return "ask";
  }
}
