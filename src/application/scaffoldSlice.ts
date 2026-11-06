import { CommandError } from "../domain/contracts.js";
import type {
  ScaffoldSliceResult,
  SliceKind,
  SliceOptions,
} from "../domain/contracts.js";
import { SLICE_LAYERS } from "../domain/contracts.js";
import {
  parseInput,
  parseSliceOptions,
  scaffoldInputSchema,
} from "../domain/schemas.js";
import type { RequireJstProject } from "./check.js";
import { boundSummary, npmCommand } from "./gate.js";
import type { CommandResult, CommandRunner } from "./ports.js";
import {
  buildScaffoldArgs,
  defaultNextAction,
  extractNextAction,
  installCommands,
  noInstallNextAction,
  parseDryRunPlan,
} from "./scaffold.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DRY_RUN_ACTION =
  "Dry run only; no files were written. Re-run jst_scaffold_slice without dryRun to create them.";

interface DryRunPlan {
  createdPaths: string[];
  dependencies: string[];
  devDependencies: string[];
}

interface ResultContext {
  layer: string;
  kind: SliceKind;
  name: string;
  command: string;
  plan: DryRunPlan;
}

interface Outcome {
  installCommands: string[];
  nextAction: string;
  dryRun: boolean;
  installFailed: boolean;
}

interface DryRunInput {
  root: string;
  baseArgs: string[];
  layer: string;
  name: string;
}

interface FallbackInput {
  root: string;
  context: ResultContext;
  opts: SliceOptions;
  run: CommandResult;
  plannedInstall: string[];
}

export async function scaffoldSlice(
  runner: CommandRunner,
  requireProject: RequireJstProject,
  input: unknown,
): Promise<ScaffoldSliceResult> {
  const { projectRoot, kind, name, options, dryRun } = parseInput(
    scaffoldInputSchema,
    input,
  );
  const project = await requireProject(projectRoot);
  const opts: SliceOptions = parseSliceOptions(options ?? {});
  const layer = SLICE_LAYERS[kind];
  const baseArgs = buildScaffoldArgs(kind, name, opts);
  const plan = await planDryRun(runner, {
    root: project.root,
    baseArgs,
    layer,
    name,
  });
  const plannedInstall = installCommands(
    project.packageManager,
    plan.dependencies,
    plan.devDependencies,
  );
  const context: ResultContext = {
    layer,
    kind,
    name,
    command: `npm ${baseArgs.join(" ")}`,
    plan,
  };
  if (dryRun) {
    return buildResult(context, {
      installCommands: plannedInstall,
      nextAction: DRY_RUN_ACTION,
      dryRun: true,
      installFailed: false,
    });
  }
  const run = await runner.run(npmCommand(), [...baseArgs, "--yes"], {
    cwd: project.root,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (run.exitCode !== 0) {
    return recoverWithoutInstall(runner, {
      root: project.root,
      context,
      opts,
      run,
      plannedInstall,
    });
  }
  const nextAction =
    extractNextAction(run.stdout) ?? defaultNextAction(layer, name);
  return buildResult(context, {
    installCommands: opts.noInstall ? plannedInstall : [],
    nextAction: opts.noInstall
      ? noInstallNextAction(plannedInstall, nextAction)
      : nextAction,
    dryRun: false,
    installFailed: false,
  });
}

async function planDryRun(
  runner: CommandRunner,
  input: DryRunInput,
): Promise<DryRunPlan> {
  const preview = await runner.run(
    npmCommand(),
    [...input.baseArgs, "--dry-run"],
    { cwd: input.root, timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  if (preview.exitCode !== 0) {
    throw new CommandError(
      `create:slice --dry-run failed: ${boundSummary(preview.stdout, preview.stderr).summary}`,
    );
  }
  return parseDryRunPlan(preview.stdout, input.layer, input.name);
}

async function recoverWithoutInstall(
  runner: CommandRunner,
  input: FallbackInput,
): Promise<ScaffoldSliceResult> {
  const retryArgs = buildScaffoldArgs(input.context.kind, input.context.name, {
    ...input.opts,
    noInstall: true,
  });
  const retry = await runner.run(npmCommand(), [...retryArgs, "--yes"], {
    cwd: input.root,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (retry.exitCode !== 0) {
    throw new CommandError(
      `create:slice failed: ${boundSummary(input.run.stdout, input.run.stderr).summary}`,
    );
  }
  const nextAction =
    extractNextAction(retry.stdout) ??
    defaultNextAction(input.context.layer, input.context.name);
  const installLine = input.plannedInstall.join(" && ");
  const nextActionText = [
    "Dependencies were not installed automatically.",
    `Install them: ${installLine}.`,
    `Then ${nextAction}`,
  ].join(" ");
  return buildResult(input.context, {
    installCommands: input.plannedInstall,
    nextAction: nextActionText,
    dryRun: false,
    installFailed: true,
  });
}

function buildResult(context: ResultContext, outcome: Outcome): ScaffoldSliceResult {
  return {
    target: `src/${context.layer}/${context.name}`,
    layer: context.layer,
    kind: context.kind,
    name: context.name,
    command: context.command,
    createdPaths: context.plan.createdPaths,
    dependencies: context.plan.dependencies,
    devDependencies: context.plan.devDependencies,
    installCommands: outcome.installCommands,
    nextAction: outcome.nextAction,
    dryRun: outcome.dryRun,
    installFailed: outcome.installFailed,
  };
}
