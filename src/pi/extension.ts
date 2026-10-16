import { Type } from "typebox";
import { JstServices } from "../application/services.js";
import { GATE_NAMES, RECIPE_NAMES, SLICE_KINDS } from "../domain/contracts.js";
import type { RecipeName } from "../domain/contracts.js";
import { createDefaultPorts } from "../infrastructure/adapters.js";
import { blockedToolCall, capProviderOutput } from "./guard.js";

export { blockedToolCall, capProviderOutput } from "./guard.js";

export interface PiContext {
  cwd: string;
}

export interface PiToolResult {
  content: { type: "text"; text: string }[];
  details?: Record<string, unknown>;
}

export interface PiToolDefinition {
  name: string;
  label?: string;
  description: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
    ctx?: PiContext,
  ): Promise<PiToolResult>;
}

export interface PiExtensionApi {
  registerTool(tool: PiToolDefinition): void;
  on?(
    event: "before_agent_start",
    handler: (event: {
      systemPrompt: string;
    }) => Promise<{ systemPrompt: string }> | { systemPrompt: string },
  ): void;
  on?(
    event: "tool_call",
    handler: (event: {
      toolName: string;
      input: unknown;
    }) => { block: true; reason: string } | undefined,
  ): void;
  on?(
    event: "before_provider_request",
    handler: (event: { payload: unknown }) => unknown,
  ): void;
}

const PI_JST_WORKFLOW = [
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

const stringEnum = (values: readonly string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

interface ToolRuntime {
  servicesFor(context?: PiContext): JstServices;
  rootFor(context: PiContext | undefined, projectRoot: unknown): string;
  text(data: unknown): PiToolResult;
  activate(projectRoot: string): void;
}

export default function jstMcpExtension(pi: PiExtensionApi): void {
  const ports = createDefaultPorts();
  let activeRoot: string | undefined;

  pi.on?.("before_agent_start", async (event) => {
    activeRoot = undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${PI_JST_WORKFLOW}` };
  });
  pi.on?.("tool_call", (event) =>
    blockedToolCall(activeRoot !== undefined, event),
  );
  pi.on?.("before_provider_request", (event) =>
    activeRoot ? capProviderOutput(event.payload) : event.payload,
  );

  const runtime: ToolRuntime = {
    servicesFor: (context) =>
      new JstServices(
        ports.runner,
        ports.project,
        context?.cwd ?? process.cwd(),
      ),
    rootFor: (context, projectRoot) =>
      typeof projectRoot === "string" && projectRoot.length > 0
        ? projectRoot
        : (context?.cwd ?? process.cwd()),
    text: (data) => ({
      content: [{ type: "text", text: JSON.stringify(data) }],
      details: {},
    }),
    activate: (projectRoot) => {
      activeRoot = projectRoot;
    },
  };

  registerStartTask(pi, runtime);
  registerScaffoldSlice(pi, runtime);
  registerRecipe(pi, runtime);
  registerCheck(pi, runtime);
}

function registerStartTask(pi: PiExtensionApi, runtime: ToolRuntime): void {
  pi.registerTool({
    name: "jst_start_task",
    label: "Start JST Task",
    description: [
      "Verify a JST project, read its project-local architecture skill, and return a concise workflow,",
      "version-local generator capabilities, exact next commands, and relevant architecture sections.",
    ].join(" "),
    promptGuidelines: [
      [
        "Use jst_start_task before implementing in a JST project to get the workflow, generator capabilities,",
        "next commands, and relevant architecture sections.",
      ].join(" "),
      [
        "After jst_start_task, follow agentRules: use JST tools instead of rereading architecture docs or",
        "inspecting generators, lint rules, framework internals, or dependency source.",
      ].join(" "),
      "Use jst_scaffold_slice for every new boundary and jst_check for quality gates.",
    ],
    parameters: Type.Object({
      projectRoot: Type.Optional(
        Type.String({
          description:
            "Project root; defaults to the session working directory.",
        }),
      ),
      brief: Type.String({
        description: "One-line description of the requested change.",
      }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const projectRoot = runtime.rootFor(ctx, params.projectRoot);
      const result = await runtime
        .servicesFor(ctx)
        .startTask({ projectRoot, brief: params.brief as string });
      runtime.activate(projectRoot);
      return runtime.text(result);
    },
  });
}

function registerScaffoldSlice(pi: PiExtensionApi, runtime: ToolRuntime): void {
  pi.registerTool({
    name: "jst_scaffold_slice",
    label: "Scaffold JST Slice",
    description: [
      "Validate kind/name/options and invoke the project-local create:slice generator,",
      "returning created relative paths and the single next action.",
    ].join(" "),
    parameters: Type.Object({
      projectRoot: Type.Optional(
        Type.String({
          description:
            "Project root; defaults to the session working directory.",
        }),
      ),
      kind: stringEnum(SLICE_KINDS),
      name: Type.String({ description: "lowerCamelCase slice name." }),
      options: Type.Optional(
        Type.Object({
          stateful: Type.Optional(Type.Boolean()),
          repository: Type.Optional(Type.Boolean()),
          service: Type.Optional(Type.Boolean()),
          persistence: Type.Optional(Type.Boolean()),
          ui: Type.Optional(Type.Boolean()),
          tests: Type.Optional(Type.Boolean()),
          msw: Type.Optional(Type.Boolean()),
          public: Type.Optional(Type.Boolean()),
          noInstall: Type.Optional(Type.Boolean()),
          style: Type.Optional(stringEnum(["css", "scss"])),
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = {
        projectRoot: runtime.rootFor(ctx, params.projectRoot),
        kind: params.kind,
        name: params.name,
        options: params.options,
      };
      return runtime.text(await runtime.servicesFor(ctx).scaffoldSlice(input));
    },
  });
}

function registerRecipe(pi: PiExtensionApi, runtime: ToolRuntime): void {
  pi.registerTool({
    name: "jst_get_recipe",
    label: "Get JST Recipe",
    description:
      "Return the matching project-local recipe section from the project's architecture skill.",
    parameters: Type.Object({
      projectRoot: Type.Optional(
        Type.String({
          description:
            "Project root; defaults to the session working directory.",
        }),
      ),
      recipe: stringEnum(RECIPE_NAMES),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const projectRoot = runtime.rootFor(ctx, params.projectRoot);
      return runtime.text(
        await runtime
          .servicesFor(ctx)
          .getRecipe(projectRoot, params.recipe as RecipeName),
      );
    },
  });
}

function registerCheck(pi: PiExtensionApi, runtime: ToolRuntime): void {
  pi.registerTool({
    name: "jst_check",
    label: "Run JST Gate",
    description: [
      "Run an existing project npm script (fix, fast, architecture, release) and return the exit status",
      "plus a bounded diagnostic summary and the prescribed next action.",
    ].join(" "),
    parameters: Type.Object({
      projectRoot: Type.Optional(
        Type.String({
          description:
            "Project root; defaults to the session working directory.",
        }),
      ),
      gate: stringEnum(GATE_NAMES),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const projectRoot = runtime.rootFor(ctx, params.projectRoot);
      return runtime.text(
        await runtime
          .servicesFor(ctx)
          .check({ projectRoot, gate: params.gate }),
      );
    },
  });
}
