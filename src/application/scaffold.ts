import { CommandError } from "../domain/contracts.js";
import type { SliceKind, SliceOptions } from "../domain/contracts.js";

export function buildScaffoldArgs(kind: SliceKind, name: string, options: SliceOptions): string[] {
  const args = ["run", "create:slice", "--", kind, name];
  appendFlag(args, options.stateful, "--stateful");
  appendFlag(args, options.repository, "--repository");
  appendFlag(args, options.service, "--service");
  appendFlag(args, options.persistence, "--persistence");
  appendFlag(args, options.ui, "--ui");
  appendFlag(args, options.tests, "--tests");
  appendFlag(args, options.msw, "--msw");
  appendFlag(args, options.public, "--public");
  appendFlag(args, options.noInstall, "--no-install");
  if (options.style) {
    args.push("--style", options.style);
  }
  return args;
}

export function parseDryRunPlan(
  stdout: string,
  layer: string,
  name: string,
): { createdPaths: string[]; dependencies: string[]; devDependencies: string[] } {
  const record = parseDryRunOutput(stdout);
  return {
    createdPaths: strings(record.files).map((file) => `src/${layer}/${name}/${file}`),
    dependencies: strings(record.dependencies),
    devDependencies: strings(record.devDependencies),
  };
}

export function extractNextAction(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith("Next:")) {
      return line.slice("Next:".length).trim();
    }
  }
  return undefined;
}

export function defaultNextAction(layer: string, name: string): string {
  return `Compose @/${layer}/${name}/${name}.public from an owning page or higher layer.`;
}

function appendFlag(args: string[], enabled: boolean | undefined, flag: string): void {
  if (enabled) {
    args.push(flag);
  }
}

function parseDryRunOutput(stdout: string): Record<string, unknown> {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new CommandError("create:slice --dry-run did not return valid JSON.");
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new CommandError("create:slice --dry-run did not return valid JSON.");
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
