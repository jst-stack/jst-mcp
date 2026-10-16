const FORBIDDEN_READ =
  /(?:^|\/)(?:AGENTS\.md|node_modules|skills)(?:\/|$)|(?:^|\/)src\/(?:entities|features|modules|widgets)\/README\.md$/u;
const FORBIDDEN_SHELL_DISCOVERY =
  /(?:^|[\s"'])(?:AGENTS\.md|node_modules|skills|src\/(?:entities|features|modules|widgets)\/README\.md)(?:[\s/"']|$)/u;
const GENERATOR_COMMAND = /npm\s+run\s+create:slice\b/u;
const GATE_COMMAND =
  /npm\s+run\s+(?:audit:production|build|check(?::release)?|doctor|knip|lint(?::(?:architecture|budgets|fix|styles(?::fix)?))?|test:(?:e2e|unit)|typecheck|validate)\b/u;
const REATOM_NODE_PROBE = /\bnode\b[^\n]*(?:@reatom|reatom)/u;
const LEGACY_REATOM = /\b(?:createCtx|ctx\.(?:get|spy))\b/u;
const MAX_OUTPUT_TOKENS = 4_096;

interface ToolCall {
  toolName: string;
  input: unknown;
}

interface BlockedCall {
  block: true;
  reason: string;
}

export function capProviderOutput(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.max_tokens === "number" &&
    record.max_tokens > MAX_OUTPUT_TOKENS
  ) {
    return { ...record, max_tokens: MAX_OUTPUT_TOKENS };
  }
  const generationConfig = record.generationConfig;
  if (typeof generationConfig !== "object" || generationConfig === null) {
    return payload;
  }
  const config = generationConfig as Record<string, unknown>;
  if (
    typeof config.maxOutputTokens !== "number" ||
    config.maxOutputTokens <= MAX_OUTPUT_TOKENS
  ) {
    return payload;
  }
  return {
    ...record,
    generationConfig: { ...config, maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
}

export function blockedToolCall(
  started: boolean,
  event: ToolCall,
): BlockedCall | undefined {
  if (!started || typeof event.input !== "object" || event.input === null) {
    return undefined;
  }
  const input = event.input as Record<string, unknown>;
  return (
    blockedRead(event.toolName, input) ??
    blockedWrite(event.toolName, input) ??
    blockedBash(event.toolName, input)
  );
}

function blockedRead(
  toolName: string,
  input: Record<string, unknown>,
): BlockedCall | undefined {
  if (
    toolName === "read" &&
    typeof input.path === "string" &&
    FORBIDDEN_READ.test(input.path)
  ) {
    return {
      block: true,
      reason:
        "jst_start_task already supplied the required contract. Read product/generated files only.",
    };
  }
  return undefined;
}

function blockedWrite(
  toolName: string,
  input: Record<string, unknown>,
): BlockedCall | undefined {
  if (
    (toolName === "write" || toolName === "edit") &&
    LEGACY_REATOM.test(JSON.stringify(input))
  ) {
    return {
      block: true,
      reason: [
        "JST pins Reatom v1001. Read atoms with state(), update with state.set(), derive with computed(),",
        "and test atoms directly; do not use createCtx, ctx.get, or ctx.spy.",
      ].join(" "),
    };
  }
  return undefined;
}

function blockedBash(
  toolName: string,
  input: Record<string, unknown>,
): BlockedCall | undefined {
  if (toolName !== "bash" || typeof input.command !== "string") {
    return undefined;
  }
  if (GENERATOR_COMMAND.test(input.command)) {
    return {
      block: true,
      reason:
        "Use jst_scaffold_slice; it validates options and runs the project-local generator.",
    };
  }
  if (GATE_COMMAND.test(input.command)) {
    return {
      block: true,
      reason: [
        "Use jst_check with fix, fast, architecture, or release;",
        "do not run a full-project gate or one of its internal stages separately.",
      ].join(" "),
    };
  }
  if (REATOM_NODE_PROBE.test(input.command)) {
    return {
      block: true,
      reason:
        "Do not run Reatom through standalone Node; use the generated store, project-local recipe, and Vitest.",
    };
  }
  if (FORBIDDEN_SHELL_DISCOVERY.test(input.command)) {
    return {
      block: true,
      reason:
        "Do not inspect JST guidance, tooling, configuration, or dependency internals after jst_start_task.",
    };
  }
  return undefined;
}
