import { Type } from "typebox";
import { JstServices } from "../application/services.js";
import { GATE_NAMES, RECIPE_NAMES, SLICE_KINDS } from "../domain/contracts.js";
import type { RecipeName } from "../domain/contracts.js";
import { createDefaultPorts } from "../infrastructure/adapters.js";

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
  on?(event: "before_agent_start", handler: (event: { systemPrompt: string }) => Promise<{ systemPrompt: string }> | { systemPrompt: string }): void;
  on?(event: "tool_call", handler: (event: { toolName: string; input: unknown }) => { block: true; reason: string } | undefined): void;
  on?(event: "before_provider_request", handler: (event: { payload: unknown }) => unknown): void;
}

const PI_JST_WORKFLOW = `JST project workflow:
- Call jst_start_task before implementation and follow its task-specific workflow.
- Do not reread AGENTS.md, the architecture skill, docs, configuration, generator/linter source, framework internals, or dependency source after jst_start_task.
- For local edits, inspect only the owner, colocated style, related test, and nearest consumer; do not scaffold or introduce architecture.
- Use jst_scaffold_slice only for a genuinely new entity, feature, module, or widget; never invoke create:slice through bash.
- Call jst_check for project gates; do not run its internal stages separately.`;

const FORBIDDEN_READ = /(?:^|\/)(?:AGENTS\.md|node_modules|skills)(?:\/|$)|(?:^|\/)src\/(?:entities|features|modules|widgets)\/README\.md$/u;
const FORBIDDEN_SHELL_DISCOVERY = /(?:^|[\s"'])(?:AGENTS\.md|node_modules|skills|src\/(?:entities|features|modules|widgets)\/README\.md)(?:[\s/"']|$)/u;
const GENERATOR_COMMAND = /npm\s+run\s+create:slice\b/u;
const GATE_COMMAND = /npm\s+run\s+(?:audit:production|build|check(?::release)?|doctor|knip|lint(?::(?:architecture|budgets|fix|styles(?::fix)?))?|test:(?:e2e|unit)|typecheck|validate)\b/u;
const REATOM_NODE_PROBE = /\bnode\b[^\n]*(?:@reatom|reatom)/u;
const LEGACY_REATOM = /\b(?:createCtx|ctx\.(?:get|spy))\b/u;
const MAX_OUTPUT_TOKENS = 4_096;

export function capProviderOutput(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const record = payload as Record<string, unknown>;
  if (typeof record.max_tokens === "number" && record.max_tokens > MAX_OUTPUT_TOKENS) {
    return { ...record, max_tokens: MAX_OUTPUT_TOKENS };
  }
  const generationConfig = record.generationConfig;
  if (typeof generationConfig !== "object" || generationConfig === null) return payload;
  const config = generationConfig as Record<string, unknown>;
  if (typeof config.maxOutputTokens !== "number" || config.maxOutputTokens <= MAX_OUTPUT_TOKENS) return payload;
  return { ...record, generationConfig: { ...config, maxOutputTokens: MAX_OUTPUT_TOKENS } };
}

export function blockedToolCall(started: boolean, event: { toolName: string; input: unknown }): { block: true; reason: string } | undefined {
  if (!started || typeof event.input !== "object" || event.input === null) return undefined;
  const input = event.input as Record<string, unknown>;
  if (event.toolName === "read" && typeof input.path === "string" && FORBIDDEN_READ.test(input.path)) {
    return { block: true, reason: "jst_start_task already supplied the required contract. Read product/generated files only." };
  }
  if ((event.toolName === "write" || event.toolName === "edit") && LEGACY_REATOM.test(JSON.stringify(input))) {
    return { block: true, reason: "JST pins Reatom v1001. Read atoms with state(), update with state.set(), derive with computed(), and test atoms directly; do not use createCtx, ctx.get, or ctx.spy." };
  }
  if (event.toolName !== "bash" || typeof input.command !== "string") return undefined;
  if (GENERATOR_COMMAND.test(input.command)) {
    return { block: true, reason: "Use jst_scaffold_slice; it validates options and runs the project-local generator." };
  }
  if (GATE_COMMAND.test(input.command)) {
    return { block: true, reason: "Use jst_check with fix, fast, architecture, or release; do not run a full-project gate or one of its internal stages separately." };
  }
  if (REATOM_NODE_PROBE.test(input.command)) {
    return { block: true, reason: "Do not run Reatom through standalone Node; use the generated store, project-local recipe, and Vitest." };
  }
  if (FORBIDDEN_SHELL_DISCOVERY.test(input.command)) {
    return { block: true, reason: "Do not inspect JST guidance, tooling, configuration, or dependency internals after jst_start_task." };
  }
  return undefined;
}

const stringEnum = (values: readonly string[]) => Type.Union(values.map((value) => Type.Literal(value)));

export default function jstMcpExtension(pi: PiExtensionApi): void {
  const ports = createDefaultPorts();
  let started = false;

  pi.on?.("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${PI_JST_WORKFLOW}`,
  }));
  pi.on?.("tool_call", (event) => blockedToolCall(started, event));
  pi.on?.("before_provider_request", (event) => capProviderOutput(event.payload));

  const servicesFor = (ctx?: PiContext): JstServices => new JstServices(ports.runner, ports.project, ctx?.cwd ?? process.cwd());

  const rootFor = (ctx: PiContext | undefined, projectRoot: unknown): string =>
    typeof projectRoot === "string" && projectRoot.length > 0 ? projectRoot : ctx?.cwd ?? process.cwd();

  const text = (data: unknown): PiToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }], details: {} });

  pi.registerTool({
    name: "jst_start_task",
    label: "Start JST Task",
    description: "Verify a JST project, read its project-local architecture skill, and return a concise workflow, version-local generator capabilities, exact next commands, and only the architecture sections relevant to the brief.",
    promptGuidelines: [
      "Use jst_start_task before implementing in a JST project to get the workflow, generator capabilities, next commands, and relevant architecture sections.",
      "After jst_start_task, follow agentRules: use JST tools instead of rereading architecture docs or inspecting generators, lint rules, framework internals, or dependency source.",
      "Use jst_scaffold_slice for every new boundary and jst_check for quality gates.",
    ],
    parameters: Type.Object({
      projectRoot: Type.Optional(Type.String({ description: "Project root; defaults to the session working directory." })),
      brief: Type.String({ description: "One-line description of the requested change." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await servicesFor(ctx).startTask({ projectRoot: rootFor(ctx, params.projectRoot), brief: params.brief as string });
      started = true;
      return text(result);
    },
  });

  pi.registerTool({
    name: "jst_scaffold_slice",
    label: "Scaffold JST Slice",
    description: "Validate kind/name/options and invoke the project-local create:slice generator, returning created relative paths and the single next action.",
    parameters: Type.Object({
      projectRoot: Type.Optional(Type.String({ description: "Project root; defaults to the session working directory." })),
      kind: stringEnum(SLICE_KINDS),
      name: Type.String({ description: "lowerCamelCase slice name." }),
      options: Type.Optional(Type.Object({
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
      })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = {
        projectRoot: rootFor(ctx, params.projectRoot),
        kind: params.kind,
        name: params.name,
        options: params.options,
      };
      return text(await servicesFor(ctx).scaffoldSlice(input));
    },
  });

  pi.registerTool({
    name: "jst_get_recipe",
    label: "Get JST Recipe",
    description: "Return the matching project-local recipe section from the project's architecture skill.",
    parameters: Type.Object({
      projectRoot: Type.Optional(Type.String({ description: "Project root; defaults to the session working directory." })),
      recipe: stringEnum(RECIPE_NAMES),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return text(await servicesFor(ctx).getRecipe(rootFor(ctx, params.projectRoot), params.recipe as RecipeName));
    },
  });

  pi.registerTool({
    name: "jst_check",
    label: "Run JST Gate",
    description: "Run an existing project npm script (fix, fast, architecture, release) and return the exit status plus a bounded diagnostic summary and the prescribed next action.",
    parameters: Type.Object({
      projectRoot: Type.Optional(Type.String({ description: "Project root; defaults to the session working directory." })),
      gate: stringEnum(GATE_NAMES),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return text(await servicesFor(ctx).check({ projectRoot: rootFor(ctx, params.projectRoot), gate: params.gate }));
    },
  });
}
