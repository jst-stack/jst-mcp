import { CommandError } from "../domain/contracts.js";
import type { ScaffoldSliceResult, SliceOptions } from "../domain/contracts.js";
import { SLICE_LAYERS } from "../domain/contracts.js";
import {
  parseInput,
  parseSliceOptions,
  scaffoldInputSchema,
} from "../domain/schemas.js";
import type { RequireJstProject } from "./check.js";
import { boundSummary, npmCommand } from "./gate.js";
import type { CommandRunner } from "./ports.js";
import {
  buildScaffoldArgs,
  defaultNextAction,
  extractNextAction,
  parseDryRunPlan,
} from "./scaffold.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export async function scaffoldSlice(
  runner: CommandRunner,
  requireProject: RequireJstProject,
  input: unknown,
): Promise<ScaffoldSliceResult> {
  const { projectRoot, kind, name, options } = parseInput(
    scaffoldInputSchema,
    input,
  );
  const project = await requireProject(projectRoot);
  const opts: SliceOptions = parseSliceOptions(options ?? {});
  const layer = SLICE_LAYERS[kind];
  const baseArgs = buildScaffoldArgs(kind, name, opts);

  const dryRun = await runner.run(npmCommand(), [...baseArgs, "--dry-run"], {
    cwd: project.root,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (dryRun.exitCode !== 0) {
    throw new CommandError(
      `create:slice --dry-run failed: ${boundSummary(dryRun.stdout, dryRun.stderr).summary}`,
    );
  }
  const plan = parseDryRunPlan(dryRun.stdout, layer, name);

  const run = await runner.run(npmCommand(), [...baseArgs, "--yes"], {
    cwd: project.root,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (run.exitCode !== 0) {
    throw new CommandError(
      `create:slice failed: ${boundSummary(run.stdout, run.stderr).summary}`,
    );
  }

  return {
    target: `src/${layer}/${name}`,
    layer,
    kind,
    name,
    command: `npm run create:slice -- ${kind} ${name}`,
    createdPaths: plan.createdPaths,
    dependencies: plan.dependencies,
    devDependencies: plan.devDependencies,
    nextAction: extractNextAction(run.stdout) ?? defaultNextAction(layer, name),
  };
}
