import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeMcpConfig, runInit } from "../src/composition/install.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jst-init-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mergeMcpConfig", () => {
  it("adds the jst server and preserves existing servers", () => {
    const merged = mergeMcpConfig({ mcpServers: { gortex: { command: "gortex" } } }, "/abs/bin.js");
    const servers = merged.mcpServers as Record<string, unknown>;
    expect(Object.keys(servers).sort()).toEqual(["gortex", "jst"]);
    expect(servers.jst).toEqual({ command: "node", args: ["/abs/bin.js"] });
  });
});

describe("runInit", () => {
  it("writes mcp.json then is idempotent", async () => {
    const piDir = await tempDir();
    const first = await runInit({ piDir });
    expect(first.changed).toBe(true);
    const raw = JSON.parse(await readFile(join(piDir, "mcp.json"), "utf8")) as Record<string, unknown>;
    expect((raw.mcpServers as Record<string, unknown>).jst).toBeTruthy();
    const second = await runInit({ piDir });
    expect(second.changed).toBe(false);
  });

  it("does not write in dry-run mode", async () => {
    const piDir = await tempDir();
    const result = await runInit({ piDir, dryRun: true });
    expect(result.changed).toBe(true);
    await expect(readFile(join(piDir, "mcp.json"), "utf8")).rejects.toThrow();
  });
});
