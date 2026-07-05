// Branch naming convention: <type>/<description>. New branches created in
// the app must carry one of these prefixes; existing branches are never
// blocked (you can always check out what's already there).

export const BRANCH_TYPES = [
  { type: "feature", label: "New features" },
  { type: "fix", label: "Bug fixes" },
  { type: "hotfix", label: "Urgent production fixes" },
  { type: "refactor", label: "Code refactoring" },
  { type: "docs", label: "Documentation updates" },
  { type: "test", label: "Test additions" },
  { type: "chore", label: "Maintenance tasks" },
  { type: "perf", label: "Performance improvements" },
  { type: "ci", label: "CI/CD changes" },
  { type: "build", label: "Build system changes" },
] as const;

export type BranchType = (typeof BRANCH_TYPES)[number]["type"];

const TYPE_SET = new Set<string>(BRANCH_TYPES.map((t) => t.type));

export function isConventionalBranchName(name: string): boolean {
  const slash = name.indexOf("/");
  if (slash <= 0) return false;
  const type = name.slice(0, slash);
  const description = name.slice(slash + 1);
  return TYPE_SET.has(type) && description.trim().length > 0;
}

/** Kebab-case a free-text description for use after the type prefix. */
export function slugifyBranchDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Turn free-form input into a conventional branch name. "fix login bug"
 * becomes fix/login-bug (leading word that matches a type is promoted to
 * the prefix); anything else defaults to feature/<slug>.
 */
export function suggestConventionalBranchName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isConventionalBranchName(trimmed)) return trimmed;
  const firstBreak = trimmed.search(/[\s/_:-]/);
  if (firstBreak > 0) {
    const head = trimmed.slice(0, firstBreak).toLowerCase();
    if (TYPE_SET.has(head)) {
      const rest = slugifyBranchDescription(trimmed.slice(firstBreak + 1));
      return rest ? `${head}/${rest}` : null;
    }
  }
  const slug = slugifyBranchDescription(trimmed);
  return slug ? `feature/${slug}` : null;
}
