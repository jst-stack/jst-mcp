import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface InitOptions {
  piDir?: string;
  dryRun?: boolean;
}

export interface InitResult {
  ok: boolean;
  configPath: string;
  binPath: string;
  extensionPath: string;
  changed: boolean;
  dryRun: boolean;
  steps: string[];
}

export function serverEntry(binPath: string): { command: string; args: string[] } {
  return { command: "node", args: [binPath] };
}

export function mergeMcpConfig(
  existing: Record<string, unknown>,
  binPath: string,
): Record<string, unknown> {
  const servers = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  return { ...existing, mcpServers: { ...servers, jst: serverEntry(binPath) } };
}

function distPath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

function piDirectory(options: InitOptions): string {
  return options.piDir ?? process.env.JST_MCP_PI_DIR ?? join(homedir(), ".pi", "agent");
}

function describe(changed: boolean, dryRun: boolean): string {
  if (!changed) {
    return "already registered";
  }
  return dryRun ? "would be registered" : "registered";
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const dryRun = options.dryRun ?? false;
  const configPath = join(piDirectory(options), "mcp.json");
  const binPath = distPath("../bin/jst-mcp.js");
  const extensionPath = distPath("../pi/extension.js");
  const existing = existsSync(configPath)
    ? (JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>)
    : {};
  const merged = mergeMcpConfig(existing, binPath);
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);
  if (changed && !dryRun) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  }
  return {
    ok: true,
    configPath,
    binPath,
    extensionPath,
    changed,
    dryRun,
    steps: [
      `MCP server "jst" ${describe(changed, dryRun)} in ${configPath}.`,
      `Pi extension file: ${extensionPath}`,
      `Add that extension to settings.json or run: pi -e ${extensionPath}`,
    ],
  };
}
