# @jst-stack/mcp

MCP server and Pi extension for [JST](https://github.com/jst-stack) architecture workflows. It exposes four operations — start a task, scaffold a slice, fetch a recipe, run a quality gate — by delegating to a project's own `npm run create:slice`, `npm run lint:*`, and `npm run check:*` scripts. It duplicates no JST generator, lint, or architecture policy: architecture guidance is read from each project's local `skills/frontend-architecture/SKILL.md`, and the package embeds only operational mappings (gate-to-script, section selection keywords, CLI-help parsing).

## Requirements

- Node.js `>= 24.15`
- A JST project (scaffolded with [`create-jst`](https://github.com/jst-stack/create-jst)) that exposes a `create:slice` script.

## Tools

| Tool | Purpose |
| --- | --- |
| `jst_start_task` | Classify the brief as a direct file/docs change, local UI edit, existing-workflow change, or new boundary; return only its workflow and relevant architecture sections. Generator discovery runs only for a new boundary. |
| `jst_scaffold_slice` | Validate kind/name/options and invoke the project-local `create:slice` generator; return created relative paths and the single next action. |
| `jst_get_recipe` | Return a project-local implementation recipe, including SSR-safe runtime mocking through an injected repository adapter. |
| `jst_check` | Run an existing npm script (`fix`, `fast`, `architecture`, `release`) and return the exit status, a bounded diagnostic summary, and the prescribed next action. |

Every response is concise JSON. Raw diagnostic output is truncated; no source files are dumped.

## Install: generic MCP clients

```bash
npm install -g @jst-stack/mcp
```

Add a stdio server to your client config, for example:

```json
{
  "mcpServers": {
    "jst": {
      "command": "jst-mcp"
    }
  }
}
```

Without a global install, configure the executable and arguments separately:

```json
{
  "mcpServers": {
    "jst": {
      "command": "npx",
      "args": ["-y", "@jst-stack/mcp"]
    }
  }
}
```

## Agent workflow

1. Call `jst_start_task` once with the project root and implementation brief.
2. For a local UI/content/style edit, change only its owner and colocated files. Use `jst_scaffold_slice` only for a genuinely new architecture boundary.
3. Implement against the returned project-local contract; request a named recipe only when the start response did not include it.
4. Run focused tests while implementing.
5. Call `jst_check` with `fast` after ordinary work. Use `fix` for mechanical repairs and `release` once at delivery; do not repeat a passing gate or run its internal scripts separately.

The start response includes a machine-readable `completionRequirement`. A task is complete only after the required gate returns `ok: true` and a `completionReceipt`.

## Install: Pi

```bash
npm install --save-dev @jst-stack/mcp
```

Load the extension (the four tools are registered automatically):

```bash
pi -e ./node_modules/@jst-stack/mcp/dist/pi/extension.js
```

Or reference the package subpath `@jst-stack/mcp/pi` from your Pi extensions configuration. The tools appear as `jst_start_task`, `jst_scaffold_slice`, `jst_get_recipe`, and `jst_check`; `projectRoot` defaults to the session working directory.

## Architecture

- Dependency direction: `domain` (contracts) → `application` (services) → `infrastructure` (adapters) → `composition` (MCP/Pi).
- The MCP transport contains no project/business policy.
- External effects (process spawn, filesystem) sit behind narrow ports and are replaceable in tests.
- Architecture sections and recipes are parsed from the project-local skill by a pure Markdown section parser; no AI summarization and no embedded architecture prose.
- Commands run via argument arrays; user values are never interpolated into a shell string.
- All tool inputs and project paths are validated fail-fast.

## Development

```bash
npm install
npm run check   # lint + build + test + npm pack --dry-run
```

## Known limitations

- `jst_scaffold_slice` runs the generator twice: a `--dry-run` to read the exact file plan, then the real run (which installs dependencies unless `--no-install` is passed).
- Diagnostic summaries are bounded to the last 4000 characters; full output is not preserved.
- `jst_start_task` and `jst_get_recipe` require `skills/frontend-architecture/SKILL.md` in the project root. Each returned section is bounded to 4000 characters and the selected section set to 6500 characters.
