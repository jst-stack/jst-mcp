import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JstServices } from "../application/services.js";
import { JstError } from "../domain/contracts.js";
import { briefSchema, gateNameSchema, projectRootSchema, recipeNameSchema, sliceKindSchema, sliceNameSchema, sliceOptionsSchema } from "../domain/schemas.js";
import { createDefaultPorts } from "../infrastructure/adapters.js";

const VERSION = "0.1.0";

function textResult(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof JstError ? error.code : "INTERNAL";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code, message } }) }] };
}

export function createMcpServer(services: JstServices): McpServer {
  const server = new McpServer({ name: "jst-mcp", version: VERSION });

  server.registerTool(
    "jst_start_task",
    {
      title: "Start a JST task",
      description: "Start every JST implementation here. Returns the project-local contract, relevant architecture sections, and agentRules that replace broad documentation, generator, linter, framework, and dependency discovery.",
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        brief: briefSchema.describe("One-line description of the requested change."),
      },
    },
    async (args) => {
      try { return textResult(await services.startTask(args)); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "jst_scaffold_slice",
    {
      title: "Scaffold a JST slice",
      description: "Validate kind/name/options and invoke the project-local create:slice generator, returning created relative paths and the single next action.",
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        kind: sliceKindSchema.describe("Slice kind: entity, feature, module, or widget."),
        name: sliceNameSchema.describe("lowerCamelCase slice name."),
        options: sliceOptionsSchema.optional().describe("Generator flags: stateful, repository, service, persistence, ui, tests, msw, public, noInstall, style."),
      },
    },
    async (args) => {
      try { return textResult(await services.scaffoldSlice(args)); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "jst_get_recipe",
    {
      title: "Get a JST recipe",
      description: "Return the matching project-local recipe section from skills/frontend-architecture/SKILL.md (http-entity, persistence-entity, stateful-feature, route-composition, optimistic-mutation).",
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        recipe: recipeNameSchema.describe("Recipe name."),
      },
    },
    async (args) => {
      try { return textResult(await services.getRecipe(args.projectRoot, args.recipe)); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    "jst_check",
    {
      title: "Run a JST quality gate",
      description: "Run an existing project npm script (fix, fast, architecture, release) and return the exit status plus a bounded diagnostic summary and the prescribed next action.",
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        gate: gateNameSchema.describe("Gate: fix, fast, architecture, or release."),
      },
    },
    async (args) => {
      try { return textResult(await services.check(args)); }
      catch (error) { return errorResult(error); }
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const ports = createDefaultPorts();
  const services = new JstServices(ports.runner, ports.project, ports.cwd);
  const server = createMcpServer(services);
  await server.connect(new StdioServerTransport());
}
