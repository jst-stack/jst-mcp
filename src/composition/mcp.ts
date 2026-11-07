import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { JstServices } from "../application/services.js";
import { JstError } from "../domain/contracts.js";
import {
  briefSchema,
  gateNameSchema,
  projectRootSchema,
  recipeNameSchema,
  sectionNameSchema,
  sliceKindSchema,
  sliceNameSchema,
  sliceOptionsSchema,
} from "../domain/schemas.js";
import { createDefaultPorts } from "../infrastructure/adapters.js";

const VERSION = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

function textResult(data: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
} {
  const result: {
    content: { type: "text"; text: string }[];
    structuredContent?: Record<string, unknown>;
  } = {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof JstError ? error.code : "INTERNAL";
  const payload = { ok: false, error: { code, message } };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

export function createMcpServer(services: JstServices): McpServer {
  const server = new McpServer({ name: "jst-mcp", version: VERSION });
  registerStartTask(server, services);
  registerScaffoldSlice(server, services);
  registerGetRecipe(server, services);
  registerGetSection(server, services);
  registerCheck(server, services);
  return server;
}

function registerStartTask(server: McpServer, services: JstServices): void {
  server.registerTool(
    "jst_start_task",
    {
      title: "Start a JST task",
      description: [
        "Start every JST implementation here. Returns the project-local contract, relevant architecture sections,",
        "the project's declared dependency stack and relevant architecture sections.",
        "If a returned section is truncated, call jst_get_section for its full text.",
      ].join(" "),
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        brief: briefSchema.describe("One-line description of the requested change."),
      },
    },
    async (args) => {
      try {
        return textResult(await services.startTask(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function registerScaffoldSlice(server: McpServer, services: JstServices): void {
  server.registerTool(
    "jst_scaffold_slice",
    {
      title: "Scaffold a JST slice",
      description: [
        "Validate kind/name/options and invoke the project-local create:slice generator,",
        "returning created relative paths and the single next action. Set dryRun to preview without writing files.",
      ].join(" "),
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        kind: sliceKindSchema.describe("Slice kind: entity, feature, module, or widget."),
        name: sliceNameSchema.describe("lowerCamelCase slice name."),
        options: sliceOptionsSchema
          .optional()
          .describe(
            [
              "Generator flags. repository, service, persistence, and msw are entity-only;",
              "msw requires repository; stateful is Reatom-specific and unavailable for widgets.",
            ].join(" "),
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe("Preview the plan without writing files; returns created paths and install commands only."),
      },
    },
    async (args) => {
      try {
        return textResult(await services.scaffoldSlice(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function registerGetRecipe(server: McpServer, services: JstServices): void {
  server.registerTool(
    "jst_get_recipe",
    {
      title: "Get a JST recipe",
      description: [
        "Return the matching project-local recipe section from skills/frontend-architecture/SKILL.md",
        "including the SSR-safe mock HTTP recipe.",
      ].join(" "),
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        recipe: recipeNameSchema.describe("Recipe name."),
      },
    },
    async (args) => {
      try {
        return textResult(await services.getRecipe(args.projectRoot, args.recipe));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function registerGetSection(server: McpServer, services: JstServices): void {
  server.registerTool(
    "jst_get_section",
    {
      title: "Get an architecture section",
      description: [
        "Return the complete, untruncated text of one architecture section from the project's skill.",
        "Use it when a section returned by jst_start_task is marked truncated.",
      ].join(" "),
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        section: sectionNameSchema.describe("Exact section name, e.g. Ownership or DI boundary."),
      },
    },
    async (args) => {
      try {
        return textResult(await services.getSection(args.projectRoot, args.section));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function registerCheck(server: McpServer, services: JstServices): void {
  server.registerTool(
    "jst_check",
    {
      title: "Run a JST quality gate",
      description: [
        "Run an existing project npm script (fix, fast, architecture, release) and return the exit status",
        "plus a bounded diagnostic summary and the prescribed next action.",
      ].join(" "),
      inputSchema: {
        projectRoot: projectRootSchema.describe("Path to the JST project root."),
        gate: gateNameSchema.describe("Gate: fix, fast, architecture, or release."),
      },
    },
    async (args) => {
      try {
        return textResult(await services.check(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export async function main(): Promise<void> {
  const ports = createDefaultPorts();
  const services = new JstServices(ports.runner, ports.project, ports.cwd);
  const server = createMcpServer(services);
  await server.connect(new StdioServerTransport());
}
