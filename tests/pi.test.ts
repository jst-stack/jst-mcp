import { describe, expect, it } from "vitest";
import jstMcpExtension, { blockedToolCall, capProviderOutput } from "../src/pi/extension.js";
import type { PiExtensionApi, PiToolDefinition } from "../src/pi/extension.js";

describe("Pi extension", () => {
  it("adds the efficient JST workflow to the system prompt", async () => {
    let handler: ((event: { systemPrompt: string }) => Promise<{ systemPrompt: string }> | { systemPrompt: string }) | undefined;
    let providerHandler: ((event: { payload: unknown }) => unknown) | undefined;
    const api: PiExtensionApi = {
      registerTool(_tool: PiToolDefinition) {},
      on(event, value) {
        if (event === "before_agent_start") handler = value as typeof handler;
        if (event === "before_provider_request") providerHandler = value as typeof providerHandler;
      },
    };

    jstMcpExtension(api);
    const result = await handler!({ systemPrompt: "base" });

    expect(result.systemPrompt).toContain("Call jst_start_task before implementation");
    expect(result.systemPrompt).toContain("never invoke create:slice through bash");
    expect(result.systemPrompt).toContain("For local edits");
    expect(result.systemPrompt).toContain("Use jst_scaffold_slice only");
    expect(result.systemPrompt).toContain("do not run its internal stages separately");
    expect(providerHandler!({ payload: { max_tokens: 32_768 } })).toEqual({ max_tokens: 32_768 });
  });

  it("blocks duplicate JST discovery after a task starts", () => {
    const readSkill = { toolName: "read", input: { path: "skills/frontend-architecture/SKILL.md" } };
    expect(blockedToolCall(false, readSkill)).toBeUndefined();
    expect(blockedToolCall(true, readSkill)?.reason).toContain("required contract");
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "npm run create:slice -- feature cart" } })?.reason)
      .toContain("jst_scaffold_slice");
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "npm run typecheck && npm run knip" } })?.reason)
      .toContain("jst_check");
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "npm run test:e2e" } })?.reason)
      .toContain("jst_check");
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "npx vitest run src/features/cart/cart.test.ts" } })).toBeUndefined();
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "find skills -type f; cat node_modules/zod/package.json" } })?.reason)
      .toContain("Do not inspect");
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "cat tsconfig.json jst.config.ts" } })).toBeUndefined();
    expect(blockedToolCall(true, { toolName: "read", input: { path: "docs/contributing.md" } })).toBeUndefined();
    expect(blockedToolCall(true, { toolName: "bash", input: { command: "node -e \"require('@reatom/core')\"" } })?.reason)
      .toContain("standalone Node");
    expect(blockedToolCall(true, { toolName: "read", input: { path: "src/entities/README.md" } })?.reason)
      .toContain("required contract");
    expect(blockedToolCall(true, { toolName: "read", input: { path: "src/features/cart/cart.store.ts" } })).toBeUndefined();
    expect(blockedToolCall(true, { toolName: "write", input: { path: "src/features/cart/cart.store.ts", content: "const value = ctx.get(state)" } })?.reason)
      .toContain("Reatom v1001");
    expect(blockedToolCall(true, { toolName: "write", input: { path: "src/features/cart/cart.store.ts", content: "const value = state()" } })).toBeUndefined();
  });

  it("caps oversized provider completions without changing smaller requests", () => {
    expect(capProviderOutput({ max_tokens: 32_768, model: "deepseek" })).toEqual({ max_tokens: 4_096, model: "deepseek" });
    expect(capProviderOutput({ generationConfig: { maxOutputTokens: 65_536 }, model: "gemini" }))
      .toEqual({ generationConfig: { maxOutputTokens: 4_096 }, model: "gemini" });
    const small = { max_tokens: 4_096 };
    expect(capProviderOutput(small)).toBe(small);
  });
});
