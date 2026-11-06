# Changelog

## Unreleased

- Add `jst_get_section` and stop truncating `jst_get_recipe` so full architecture text is always reachable.
- Add `dryRun` to `jst_scaffold_slice`; on install failure, retry with `--no-install`, still create the slice, and report `installFailed` with recovery commands.
- Expose `structuredContent` on tool results to remove double JSON parsing.
- Register `jst_get_section` in the Pi extension.
- Add `jst-mcp init` to register the `jst` MCP server in `mcp.json` and the Pi extension in `settings.json` (idempotent, `--dry-run`, preserves other entries).

## 0.1.4

- Confine project commands to canonical JST workspace roots, including symlink resolution.
- Validate slice options before generator execution and run the complete architecture lint contract.
- Return exact deferred-install commands and focused dependency/cache recovery guidance.

## 0.1.1

- Pin mature Zod and TypeBox releases so JST's seven-day pnpm supply-chain policy accepts clean generated projects.

## 0.1.0

- Provide client-neutral MCP tools for task guidance, slice scaffolding, architecture recipes, and quality gates.
- Route direct changes, local UI edits, existing workflows, and new boundaries through task-specific context budgets.
- Include an optional Pi adapter with duplicate-discovery, generator, gate, and legacy-Reatom guards.
