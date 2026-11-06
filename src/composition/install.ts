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
  settingsPath: string;
  changed: boolean;
  settingsChanged: boolean;
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

export function mergeSettings(
  existing: Record<string, unknown>,
  extensionPath: string,
): Record<string, unknown> {
  const current = existing.extensions;
  if (current !== undefined && !Array.isArray(current)) {
    return existing;
  }
  const list = Array.isArray(current) ? (current as unknown[]) : [];
  if (list.includes(extensionPath)) {
    return existing;
  }
  return { ...existing, extensions: [...list, extensionPath] };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return existsSync(path)
    ? (JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>)
    : {};
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
  const directory = piDirectory(options);
  const configPath = join(directory, "mcp.json");
  const settingsPath = join(directory, "settings.json");
  const binPath = distPath("../bin/jst-mcp.js");
  const extensionPath = distPath("../pi/extension.js");
  const config = await readJson(configPath);
  const settings = await readJson(settingsPath);
  const mergedConfig = mergeMcpConfig(config, binPath);
  const mergedSettings = mergeSettings(settings, extensionPath);
  const configChanged = JSON.stringify(config) !== JSON.stringify(mergedConfig);
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(mergedSettings);
  if (!dryRun) {
    if (configChanged) {
      await writeJson(configPath, mergedConfig);
    }
    if (settingsChanged) {
      await writeJson(settingsPath, mergedSettings);
    }
  }
  return {
    ok: true,
    configPath,
    settingsPath,
    binPath,
    extensionPath,
    changed: configChanged,
    settingsChanged,
    dryRun,
    steps: [
      `MCP server "jst" ${describe(configChanged, dryRun)} in ${configPath}.`,
      `Pi extension ${describe(settingsChanged, dryRun)} in ${settingsPath}.`,
      `Fallback: run pi -e ${extensionPath}`,
    ],
  };
}
