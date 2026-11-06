export const PI_JST_WORKFLOW = [
  "JST project workflow:",
  "- Call jst_start_task before implementation and follow its task-specific workflow.",
  [
    "- Do not reread AGENTS.md, the architecture skill, docs, configuration, generator/linter source,",
    "framework internals, or dependency source after jst_start_task.",
  ].join(" "),
  [
    "- For local edits, inspect only the owner, colocated style, related test, and nearest consumer;",
    "do not scaffold or introduce architecture.",
  ].join(" "),
  [
    "- Use jst_scaffold_slice only for a genuinely new entity, feature, module, or widget;",
    "never invoke create:slice through bash.",
  ].join(" "),
  "- Call jst_check for project gates; do not run its internal stages separately.",
].join("\n");
