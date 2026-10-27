import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const binPath = resolve(process.cwd(), "dist", "bin", "jst-mcp.js");
const skip = !existsSync(binPath);
const packageVersion = (JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string })
  .version;

const FIXTURE_SKILL = `# Frontend architecture

## Efficient agent loop

1. Run \`npm run create:slice -- --help\` first.

## Recipes

### http-entity

**Intent:** A typed HTTP boundary.

**Flow:**

- \`npm run create:slice -- entity <name> --repository --tests\`

### mock-http-ssr

**Intent:** SSR-safe runtime mocks through an injected repository adapter.
`;

interface RpcMessage {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: unknown;
}

interface Tool {
  name: string;
  inputSchema?: { required?: string[]; properties?: Record<string, unknown> };
}

function launch() {
  const child = spawn(process.execPath, [binPath], { stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout! });
  const pending: ((message: RpcMessage) => void)[] = [];
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    const message = JSON.parse(line) as RpcMessage;
    pending.shift()?.(message);
  });
  return {
    send(message: unknown) {
      child.stdin!.write(`${JSON.stringify(message)}\n`);
    },
    next(): Promise<RpcMessage> {
      return new Promise((resolvePromise) => pending.push(resolvePromise));
    },
    close() {
      rl.close();
      child.kill();
    },
  };
}

describe.skipIf(skip)("jst-mcp stdio black-box", () => {
  const server = launch();
  let fixtureRoot = "";

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(resolve(tmpdir(), "jst-mcp-"));
    const skillDir = resolve(fixtureRoot, "skills", "frontend-architecture");
    await mkdir(skillDir, { recursive: true });
    await writeFile(resolve(skillDir, "SKILL.md"), FIXTURE_SKILL);
    await writeFile(
      resolve(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "mcp-fixture",
        scripts: { "create:slice": "node help.mjs" },
      }),
    );
  });

  afterAll(async () => {
    server.close();
    if (fixtureRoot) {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("initializes and lists the four tools with input schemas", async () => {
    server.send({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
    });
    const init = await server.next();
    expect(init.id).toBe(0);
    expect(init.error).toBeUndefined();
    expect((init.result as { serverInfo: { version: string } }).serverInfo.version).toBe(packageVersion);

    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const listed = await server.next();
    const tools = (listed.result as { tools: Tool[] }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "jst_check",
      "jst_get_recipe",
      "jst_scaffold_slice",
      "jst_start_task",
    ]);

    const scaffold = tools.find((tool) => tool.name === "jst_scaffold_slice")!;
    expect(scaffold.inputSchema?.required).toEqual(["projectRoot", "kind", "name"]);

    const recipe = tools.find((tool) => tool.name === "jst_get_recipe")!;
    expect(recipe.inputSchema?.required).toEqual(["projectRoot", "recipe"]);
  });

  it("calls jst_get_recipe and returns the project-local recipe section", async () => {
    server.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "jst_get_recipe", arguments: { projectRoot: fixtureRoot, recipe: "http-entity" } },
    });
    const response = await server.next();
    expect(response.id).toBe(2);
    const content = (response.result as { content: { type: string; text: string }[] }).content;
    const parsed = JSON.parse(content[0]!.text) as { recipe: string; body: string };
    expect(parsed.recipe).toBe("http-entity");
    expect(parsed.body).toContain("**Intent:** A typed HTTP boundary.");
  });

  it("returns a minimal direct-change contract through stdio", async () => {
    server.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "jst_start_task", arguments: { projectRoot: fixtureRoot, brief: "update README setup section" } },
    });
    const response = await server.next();
    const content = (response.result as { content: { text: string }[] }).content;
    const parsed = JSON.parse(content[0]!.text) as { taskKind: string; sections: unknown[]; capabilities?: unknown };
    expect(parsed.taskKind).toBe("direct-change");
    expect(parsed.sections).toEqual([]);
    expect(parsed.capabilities).toBeUndefined();
  });

  it("returns an error result for an invalid project", async () => {
    server.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "jst_start_task",
        arguments: { projectRoot: "/definitely/not/a/real/project", brief: "add login" },
      },
    });
    const response = await server.next();
    expect(response.id).toBe(3);
    const result = response.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).error.code).toBe("INVALID_PROJECT");
  });
});
